using Feedboard.Models;
using Feedboard.Services;
using Microsoft.Windows.Widgets;
using Microsoft.Windows.Widgets.Providers;
using System.Diagnostics;
using System.Text.Json;

namespace Feedboard.Widgets;

public sealed class FeedWidget : IDisposable
{
    public const string DefinitionId = "Feedboard_Headlines";
    private const int MaxRememberedReadArticles = 200;

    private readonly string _id;
    private readonly FeedStore _store = new();
    private readonly AppSettingsStore _settingsStore = new();
    private readonly FeedClient _client = new();
    private readonly SemaphoreSlim _refreshGate = new(1, 1);
    private readonly object _lifecycleGate = new();

    private IReadOnlyList<FeedArticle> _articles = Array.Empty<FeedArticle>();
    private IReadOnlyList<FeedSource> _customizationSources = Array.Empty<FeedSource>();
    private WidgetState _state;
    private WidgetSize _size;
    private Timer? _timer;
    private TimeSpan _refreshInterval = TimeSpan.FromMinutes(AppSettingsStore.DefaultRefreshIntervalMinutes);
    private DateTimeOffset _updatedAt = DateTimeOffset.Now;
    private bool _isCustomizing;
    private bool _disposed;

    public FeedWidget(string id, string customState, WidgetSize size)
    {
        _id = id;
        _state = ParseState(customState);
        _size = size;
    }

    public void Activate()
    {
        lock (_lifecycleGate)
        {
            if (_disposed)
            {
                return;
            }

            _timer ??= new Timer(_ => RefreshTimerCallback(), null, TimeSpan.Zero, _refreshInterval);
        }
    }

    public void Deactivate()
    {
        Timer? timer;
        lock (_lifecycleGate)
        {
            timer = _timer;
            _timer = null;
        }

        timer?.Dispose();
    }

    public Task RefreshAsync(CancellationToken cancellationToken = default) =>
        RefreshAsync(waitForTurn: false, cancellationToken);

    private async Task RefreshAsync(bool waitForTurn, CancellationToken cancellationToken)
    {
        if (_disposed)
        {
            return;
        }

        var entered = waitForTurn
            ? await WaitForRefreshTurnAsync(cancellationToken)
            : await _refreshGate.WaitAsync(0, cancellationToken);
        if (!entered)
        {
            return;
        }

        try
        {
            await UpdateRefreshIntervalAsync(cancellationToken);
            var sources = await _store.LoadAsync(cancellationToken);
            if (_state.SelectedFeedUrls is not null)
            {
                var selected = new HashSet<string>(_state.SelectedFeedUrls, StringComparer.OrdinalIgnoreCase);
                sources = sources.Where(source => selected.Contains(source.Url)).ToList();
            }

            _articles = await _client.LoadAsync(sources, cancellationToken);
            _updatedAt = DateTimeOffset.Now;

            if (_state.ExpandedArticleId is not null && _articles.All(x => x.Id != _state.ExpandedArticleId))
            {
                _state = _state with { ExpandedArticleId = null };
            }

            PushCurrentCard();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception ex)
        {
            Trace.TraceError($"Feedboard refresh failed: {ex}");
        }
        finally
        {
            _refreshGate.Release();
        }
    }

    private async Task<bool> WaitForRefreshTurnAsync(CancellationToken cancellationToken)
    {
        await _refreshGate.WaitAsync(cancellationToken);
        if (_disposed)
        {
            _refreshGate.Release();
            return false;
        }

        return true;
    }

    public async Task BeginCustomizationAsync(CancellationToken cancellationToken = default)
    {
        _customizationSources = (await _store.LoadAsync(cancellationToken))
            .Where(source => source.Enabled)
            .ToList();
        _isCustomizing = true;
        PushCustomizationCard();
    }

    public void UpdateContext(WidgetSize size)
    {
        var previousSize = _size;
        _size = size;

        if ((int)size < (int)previousSize && _state.ExpandedArticleId is not null)
        {
            _state = _state with { ExpandedArticleId = null };
        }

        PushCurrentCard();
    }

    public void OnActionInvoked(WidgetActionInvokedArgs args)
    {
        const string expandPrefix = "expand:";
        const string openPrefix = "open:";
        const string customizeTogglePrefix = "customize:toggle:";

        if (_isCustomizing)
        {
            if (args.Verb == "customize:done")
            {
                _isCustomizing = false;
                RefreshAsync(waitForTurn: true, CancellationToken.None).GetAwaiter().GetResult();
                return;
            }

            if (args.Verb == "customize:all")
            {
                _state = _state with { SelectedFeedUrls = null };
                PushCustomizationCard();
                return;
            }

            if (args.Verb.StartsWith(customizeTogglePrefix, StringComparison.Ordinal) &&
                int.TryParse(args.Verb[customizeTogglePrefix.Length..], out var index) &&
                index >= 0 && index < _customizationSources.Count)
            {
                ToggleCustomizationSource(_customizationSources[index].Url);
                PushCustomizationCard();
            }

            return;
        }

        if (args.Verb.StartsWith(expandPrefix, StringComparison.Ordinal))
        {
            var articleId = args.Verb[expandPrefix.Length..];
            if (_articles.Any(x => x.Id == articleId))
            {
                MarkArticleRead(articleId);
                _state = _state with { ExpandedArticleId = articleId };
                PushCurrentCard();
            }

            return;
        }

        if (args.Verb.StartsWith(openPrefix, StringComparison.Ordinal))
        {
            var articleId = args.Verb[openPrefix.Length..];
            var article = _articles.FirstOrDefault(x => x.Id == articleId);
            if (article is not null && Uri.TryCreate(article.Url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            {
                try
                {
                    Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true });
                    MarkArticleRead(articleId);
                    PushCurrentCard();
                }
                catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or PlatformNotSupportedException)
                {
                    Trace.TraceError($"Feedboard failed to open article: {ex}");
                }
            }
        }
    }

    public void PushCurrentCard()
    {
        if (_disposed)
        {
            return;
        }

        if (_isCustomizing)
        {
            PushCustomizationCard();
            return;
        }

        var options = new WidgetUpdateRequestOptions(_id)
        {
            Template = WidgetCardRenderer.Render(_articles, _state, _updatedAt, _size),
            Data = "{}",
            CustomState = JsonSerializer.Serialize(_state)
        };

        WidgetManager.GetDefault().UpdateWidget(options);
    }

    public void Dispose()
    {
        Timer? timer;
        lock (_lifecycleGate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            timer = _timer;
            _timer = null;
        }

        if (timer is not null)
        {
            using var drained = new ManualResetEvent(false);
            if (timer.Dispose(drained))
            {
                drained.WaitOne();
            }
        }

        _refreshGate.Wait();
        _refreshGate.Release();
        _refreshGate.Dispose();
    }

    private void MarkArticleRead(string articleId)
    {
        var readIds = _state.ReadArticleIds is not { Count: > 0 }
            ? new List<string>()
            : _state.ReadArticleIds.Where(id => !string.Equals(id, articleId, StringComparison.Ordinal)).ToList();

        readIds.Insert(0, articleId);
        if (readIds.Count > MaxRememberedReadArticles)
        {
            readIds.RemoveRange(MaxRememberedReadArticles, readIds.Count - MaxRememberedReadArticles);
        }

        _state = _state with { ReadArticleIds = readIds };
    }

    private void ToggleCustomizationSource(string url)
    {
        var selected = _state.SelectedFeedUrls is null
            ? new HashSet<string>(_customizationSources.Select(source => source.Url), StringComparer.OrdinalIgnoreCase)
            : new HashSet<string>(_state.SelectedFeedUrls, StringComparer.OrdinalIgnoreCase);

        if (!selected.Add(url))
        {
            selected.Remove(url);
        }

        _state = _state with { SelectedFeedUrls = selected.OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToList() };
    }

    private void PushCustomizationCard()
    {
        if (_disposed)
        {
            return;
        }

        var options = new WidgetUpdateRequestOptions(_id)
        {
            Template = WidgetCustomizationRenderer.Render(_customizationSources, _state),
            Data = "{}",
            CustomState = JsonSerializer.Serialize(_state)
        };

        WidgetManager.GetDefault().UpdateWidget(options);
    }

    private async Task UpdateRefreshIntervalAsync(CancellationToken cancellationToken)
    {
        var settings = await _settingsStore.LoadAsync(cancellationToken);
        var nextInterval = TimeSpan.FromMinutes(settings.RefreshIntervalMinutes);
        if (nextInterval == _refreshInterval)
        {
            return;
        }

        _refreshInterval = nextInterval;
        lock (_lifecycleGate)
        {
            _timer?.Change(_refreshInterval, _refreshInterval);
        }
    }

    private void RefreshTimerCallback()
    {
        try
        {
            RefreshAsync().GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            Trace.TraceError($"Feedboard timer refresh failed: {ex}");
        }
    }

    private static WidgetState ParseState(string customState)
    {
        if (string.IsNullOrWhiteSpace(customState))
        {
            return new WidgetState();
        }

        try
        {
            return JsonSerializer.Deserialize<WidgetState>(customState) ?? new WidgetState();
        }
        catch (JsonException)
        {
            return new WidgetState();
        }
    }
}
