using System.Text.Json;

namespace Feedboard.Services;

public sealed record AppSettings(int RefreshIntervalMinutes = 15);

public sealed class AppSettingsStore
{
    public const int DefaultRefreshIntervalMinutes = 15;
    public static readonly IReadOnlyList<int> SupportedRefreshIntervals = new[] { 5, 15, 30, 60 };

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public AppSettingsStore(string? path = null)
    {
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Feedboard");
        _path = path ?? Path.Combine(root, "settings.json");
    }

    public async Task<AppSettings> LoadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using var processLock = await AcquireProcessLockAsync(cancellationToken);
            if (!File.Exists(_path)) return new AppSettings();

            try
            {
                await using var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, useAsync: true);
                var settings = await JsonSerializer.DeserializeAsync<AppSettings>(stream, JsonOptions, cancellationToken) ?? new AppSettings();
                return Normalize(settings);
            }
            catch (JsonException)
            {
                QuarantineCorruptStore();
                return new AppSettings();
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task SetRefreshIntervalAsync(int minutes, CancellationToken cancellationToken = default)
    {
        if (!SupportedRefreshIntervals.Contains(minutes))
            throw new ArgumentOutOfRangeException(nameof(minutes), "Unsupported refresh interval.");

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using var processLock = await AcquireProcessLockAsync(cancellationToken);
            await WriteAsync(new AppSettings(minutes), cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    private static AppSettings Normalize(AppSettings settings) =>
        SupportedRefreshIntervals.Contains(settings.RefreshIntervalMinutes)
            ? settings
            : new AppSettings();

    private async Task WriteAsync(AppSettings settings, CancellationToken cancellationToken)
    {
        var directory = GetDirectory();
        Directory.CreateDirectory(directory);
        var tempPath = Path.Combine(directory, $".{Path.GetFileName(_path)}.{Guid.NewGuid():N}.tmp");
        try
        {
            await using (var stream = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, useAsync: true))
            {
                await JsonSerializer.SerializeAsync(stream, settings, JsonOptions, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }

            File.Move(tempPath, _path, overwrite: true);
        }
        finally
        {
            if (File.Exists(tempPath)) File.Delete(tempPath);
        }
    }

    private void QuarantineCorruptStore()
    {
        try
        {
            if (!File.Exists(_path)) return;
            File.Move(_path, $"{_path}.corrupt-{DateTimeOffset.UtcNow:yyyyMMddHHmmssfff}", overwrite: false);
        }
        catch (IOException)
        {
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
