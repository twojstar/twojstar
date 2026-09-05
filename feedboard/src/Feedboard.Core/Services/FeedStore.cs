using Feedboard.Models;
using System.Text.Json;

namespace Feedboard.Services;

public sealed class FeedStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public FeedStore(string? path = null)
    {
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Feedboard");
        _path = path ?? Path.Combine(root, "feeds.json");
    }

    public async Task<IReadOnlyList<FeedSource>> LoadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using var processLock = await AcquireProcessLockAsync(cancellationToken);
            return Ordered(NormalizeSources(await ReadSourcesAsync(cancellationToken)));
        }
        finally { _gate.Release(); }
    }

    public async Task AddAsync(string url, CancellationToken cancellationToken = default)
    {
        if (!TryNormalizeUrl(url, out var normalizedUrl))
            throw new ArgumentException("Feed URL must be an absolute HTTP(S) URL.", nameof(url));

        await MergeAsync(new[] { new FeedSource(normalizedUrl) }, cancellationToken);
    }

    public async Task MergeAsync(IEnumerable<FeedSource> incoming, CancellationToken cancellationToken = default)
    {
        await MutateAsync(byUrl =>
        {
            foreach (var source in incoming)
            {
                if (source is null || !TryNormalizeUrl(source.Url, out var normalizedUrl)) continue;
                var id = byUrl.TryGetValue(normalizedUrl, out var existing)
                    ? existing.StableId
                    : source.StableId;
                byUrl[normalizedUrl] = source with { Url = normalizedUrl, Id = id };
            }
        }, cancellationToken);
    }

    public Task RemoveAsync(string id, CancellationToken cancellationToken = default) =>
        MutateAsync(byUrl =>
        {
            var source = FindById(byUrl, id);
            if (source is not null) byUrl.Remove(source.Url);
        }, cancellationToken);

    public Task SetEnabledAsync(string id, bool enabled, CancellationToken cancellationToken = default) =>
        MutateAsync(byUrl =>
        {
            var source = FindById(byUrl, id);
            if (source is not null) byUrl[source.Url] = source with { Enabled = enabled, Id = source.StableId };
        }, cancellationToken);

    public async Task SetTitleAsync(string id, string? title, CancellationToken cancellationToken = default)
    {
        var normalizedTitle = string.IsNullOrWhiteSpace(title) ? null : title.Trim();
        if (normalizedTitle?.Length > 120)
            throw new ArgumentException("Feed name must be 120 characters or fewer.", nameof(title));

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using var processLock = await AcquireProcessLockAsync(cancellationToken);
            var byUrl = NormalizeSources(await ReadSourcesAsync(cancellationToken));
            var source = FindById(byUrl, id);
            if (source is null || string.Equals(source.Title, normalizedTitle, StringComparison.Ordinal)) return;

            byUrl[source.Url] = source with { Title = normalizedTitle, Id = source.StableId };
            await WriteSourcesAsync(Ordered(byUrl), cancellationToken);
        }
        finally { _gate.Release(); }
    }

    public async Task SetUrlAsync(string id, string url, CancellationToken cancellationToken = default)
    {
        if (!TryNormalizeUrl(url, out var normalizedUrl))
            throw new ArgumentException("Feed URL must be an absolute HTTP(S) URL.", nameof(url));

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using var processLock = await AcquireProcessLockAsync(cancellationToken);
            var byUrl = NormalizeSources(await ReadSourcesAsync(cancellationToken));
            var source = FindById(byUrl, id);
            if (source is null || string.Equals(source.Url, normalizedUrl, StringComparison.OrdinalIgnoreCase)) return;

            if (byUrl.TryGetValue(normalizedUrl, out var duplicate) &&
                !string.Equals(duplicate.StableId, source.StableId, StringComparison.Ordinal))
            {
                throw new InvalidOperationException("That feed URL is already saved.");
            }

            byUrl.Remove(source.Url);
            byUrl[normalizedUrl] = source with { Url = normalizedUrl, Id = source.StableId };
            await WriteSourcesAsync(Ordered(byUrl), cancellationToken);
        }
        finally { _gate.Release(); }
    }

    private async Task MutateAsync(Action<Dictionary<string, FeedSource>> mutation, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using var processLock = await AcquireProcessLockAsync(cancellationToken);
            var byUrl = NormalizeSources(await ReadSourcesAsync(cancellationToken));
            mutation(byUrl);
            await WriteSourcesAsync(Ordered(byUrl), cancellationToken);
        }
        finally { _gate.Release(); }
    }

    private async Task<IReadOnlyList<FeedSource>> ReadSourcesAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path)) return Array.Empty<FeedSource>();
        try
        {
            await using var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, useAsync: true);
            return await JsonSerializer.DeserializeAsync<List<FeedSource>>(stream, JsonOptions, cancellationToken) ?? new List<FeedSource>();
        }
        catch (JsonException)
        {
            QuarantineCorruptStore();
            return Array.Empty<FeedSource>();
        }
    }

    private async Task WriteSourcesAsync(IReadOnlyList<FeedSource> sources, CancellationToken cancellationToken)
    {
        var directory = GetDirectory();
        Directory.CreateDirectory(directory);
        var tempPath = Path.Combine(directory, $".{Path.GetFileName(_path)}.{Guid.NewGuid():N}.tmp");
        try
        {
            await using (var write = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, useAsync: true))
            {
                await JsonSerializer.SerializeAsync(write, sources, JsonOptions, cancellationToken);
                await write.FlushAsync(cancellationToken);
            }
            File.Move(tempPath, _path, overwrite: true);
        }
        finally { if (File.Exists(tempPath)) File.Delete(tempPath); }
    }

    private static Dictionary<string, FeedSource> NormalizeSources(IEnumerable<FeedSource> sources)
    {
        var byUrl = new Dictionary<string, FeedSource>(StringComparer.OrdinalIgnoreCase);
        foreach (var source in sources)
        {
            if (source is null || !TryNormalizeUrl(source.Url, out var normalizedUrl)) continue;
            var id = string.IsNullOrWhiteSpace(source.Id) ? FeedIdentity.FromUrl(normalizedUrl) : source.Id.Trim();
            byUrl[normalizedUrl] = source with { Url = normalizedUrl, Id = id };
        }
        return byUrl;
    }

    private static FeedSource? FindById(Dictionary<string, FeedSource> sources, string id) =>
        sources.Values.FirstOrDefault(source => string.Equals(source.StableId, id, StringComparison.Ordinal));

    private static IReadOnlyList<FeedSource> Ordered(Dictionary<string, FeedSource> sources) =>
        sources.Values.OrderBy(x => x.Title ?? x.Url).ToList();

    private static bool TryNormalizeUrl(string? url, out string normalizedUrl)
    {
        normalizedUrl = string.Empty;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)) return false;
        normalizedUrl = uri.ToString();
        return true;
    }

    private void QuarantineCorruptStore()
    {
        try
        {
            if (!File.Exists(_path)) return;
            File.Move(_path, $"{_path}.corrupt-{DateTimeOffset.UtcNow:yyyyMMddHHmmssfff}", overwrite: false);
        }
        catch (IOException) { }
    }

    private async Task<FileStream> AcquireProcessLockAsync(CancellationToken cancellationToken)
    {
        var directory = GetDirectory();
        Directory.CreateDirectory(directory);
        var lockPath = _path + ".lock";
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try { return new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 1, useAsync: true); }
            catch (IOException) { await Task.Delay(50, cancellationToken); }
        }
    }

    private string GetDirectory()
    {
        var directory = Path.GetDirectoryName(_path);
        return string.IsNullOrWhiteSpace(directory) ? Directory.GetCurrentDirectory() : directory;
    }
}