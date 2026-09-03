using Feedboard.Models;
using System.Text.Json;

namespace Feedboard.Services;

public sealed class FeedStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

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
            return await ReadSourcesAsync(cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task AddAsync(string url, CancellationToken cancellationToken = default)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
        {
            throw new ArgumentException("Feed URL must be an absolute HTTP(S) URL.", nameof(url));
        }

        await MergeAsync(new[] { new FeedSource(uri.ToString()) }, cancellationToken);
    }

    public async Task MergeAsync(IEnumerable<FeedSource> incoming, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using var processLock = await AcquireProcessLockAsync(cancellationToken);
            var current = (await ReadSourcesAsync(cancellationToken)).ToList();
            var byUrl = current.ToDictionary(x => x.Url, StringComparer.OrdinalIgnoreCase);

            foreach (var source in incoming)
            {
                if (!Uri.TryCreate(source.Url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
                {
                    continue;
                }

                byUrl[source.Url] = source;
            }

            var directory = GetDirectory();
            Directory.CreateDirectory(directory);
            var tempPath = Path.Combine(directory, $".{Path.GetFileName(_path)}.{Guid.NewGuid():N}.tmp");

            try
            {
                await using (var write = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, useAsync: true))
                {
                    await JsonSerializer.SerializeAsync(write, byUrl.Values.OrderBy(x => x.Title ?? x.Url).ToList(), JsonOptions, cancellationToken);
                    await write.FlushAsync(cancellationToken);
                }

                File.Move(tempPath, _path, overwrite: true);
            }
            finally
            {
                if (File.Exists(tempPath))
                {
                    File.Delete(tempPath);
                }
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<IReadOnlyList<FeedSource>> ReadSourcesAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path))
        {
            return Array.Empty<FeedSource>();
        }

        try
        {
            await using var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, useAsync: true);
            return await JsonSerializer.DeserializeAsync<List<FeedSource>>(stream, JsonOptions, cancellationToken)
                ?? new List<FeedSource>();
        }
        catch (JsonException)
        {
            QuarantineCorruptStore();
            return Array.Empty<FeedSource>();
        }
    }

    private void QuarantineCorruptStore()
    {
        try
        {
            if (!File.Exists(_path))
            {
                return;
            }

            var corruptPath = $"{_path}.corrupt-{DateTimeOffset.UtcNow:yyyyMMddHHmmssfff}";
            File.Move(_path, corruptPath, overwrite: false);
        }
        catch (IOException)
        {
            // Best effort: a concurrent recovery may already have moved the file.
        }
    }

    private async Task<FileStream> AcquireProcessLockAsync(CancellationToken cancellationToken)
    {
        var directory = GetDirectory();
        Directory.CreateDirectory(directory);
        var lockPath = _path + ".lock";

        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                return new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 1, useAsync: true);
            }
            catch (IOException)
            {
                await Task.Delay(50, cancellationToken);
            }
        }
    }

    private string GetDirectory()
    {
        var directory = Path.GetDirectoryName(_path);
        return string.IsNullOrWhiteSpace(directory) ? Directory.GetCurrentDirectory() : directory;
    }
}
