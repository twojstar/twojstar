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
    private readonly object _stateGate = new();

    private IReadOnlyList<FeedArticle> _articles = Array.Empty<FeedArticle>();
    private IReadOnlyList<FeedSource> _customizationSources = Array.Empty<FeedSource>();
    private IReadOnlyList<string> _feedErrorLabels = Array.Empty<string>();
    private int _visibleFeedCount;
    private WidgetState _state;
    private WidgetSize _size;
    private Timer? _timer;
    private TimeSpan _refreshInterval = TimeSpan.FromMinutes(AppSettingsStore.DefaultRefreshIntervalMinutes);
    private DateTimeOffset _updatedAt = DateTimeOffset.Now;
    private bool _isCustomizing;
    private volatile bool _disposed;

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
            if (_disposed) return;
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
        if (_disposed) return;

        var entered = waitForTurn
            ? await WaitForRefreshTurnAsync(cancellationToken)
            : await _refreshGate.WaitAsync(0, cancellationToken);
        if (!entered) return;

        try
        {
            await UpdateRefreshIntervalAsync(cancellationToken);
            var sources = await _store.LoadAsync(cancellationToken);
            MigrateLegacyFeedSelection();
            IReadOnlyList<string>? selectedFeedIds;
            lock (_stateGate)
            {
                selectedFeedIds = _state.SelectedFeedIds?.ToList();
            }
            if (selectedFeedIds is not null)
            {
                var selected = new HashSet<string>(selectedFeedIds, StringComparer.Ordinal);
                sources = sources.Where(source => selected.Contains(source.StableId)).ToList();
            }

            var visibleFeedCount = sources.Count(source => source.Enabled);
            var articles = await _client.LoadAsync(sources, cancellationToken);
            var errors = _client.GetErrorStatuses(sources)
                .Select(status => status.FeedUrl)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var feedErrorLabels = sources
                .Where(source => errors.Contains(source.Url))
                .Select(source => source.Title ?? source.Url)
                .ToList();

            lock (_stateGate)
            {
                _visibleFeedCount = visibleFeedCount;
                _articles = articles;
                _feedErrorLabels = feedErrorLabels;
                _updatedAt = DateTimeOffset.Now;
                if (_state.ExpandedArticleId is not null && _articles.All(x => x.Id != _state.ExpandedArticleId))
                {
                    _state = _state with { ExpandedArticleId = null };
                }
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
        var sources = (await _store.LoadAsync(cancellationToken))
            .Where(source => source.Enabled)
            .ToList();
        lock (_stateGate)
        {
            _customizationSources = sources;
            MigrateLegacyFeedSelectionLocked();
            _isCustomizing = true;
        }
        PushCustomizationCard();
    }

    public void UpdateContext(WidgetSize size)
    {
        lock (_stateGate)
        {
            var previousSize = _size;
            _size = size;
            if ((int)size < (int)previousSize && _state.ExpandedArticleId is not null)
            {
                _state = _state with { ExpandedArticleId = null };
            }
        }
        PushCurrentCard();
    }

    public void OnActionInvoked(WidgetActionInvokedArgs args)
    {
        const string expandPrefix = "expand:";
        const string openPrefix = "open:";
        const string customizeTogglePrefix = "customize:toggle:";
        bool customizing;
        lock (_stateGate) { customizing = _isCustomizing; }

        if (!customizing && args.Verb == "refresh")
        {
            RefreshAsync(waitForTurn: true, CancellationToken.None).GetAwaiter().GetResult();
            return;
        }

        if (customizing)
        {
            if (args.Verb == "customize:done")
            {
                lock (_stateGate) { _isCustomizing = false; }
                RefreshAsync(waitForTurn: true, CancellationToken.None).GetAwaiter().GetResult();
                return;
            }
            if (args.Verb == "customize:all")
            {
                lock (_stateGate) { _state = _state with { SelectedFeedUrls = null, SelectedFeedIds = null }; }
                PushCustomizationCard();
                return;
            }
            if (args.Verb.StartsWith(customizeTogglePrefix, StringComparison.Ordinal) &&
                int.TryParse(args.Verb[customizeTogglePrefix.Length..], out var index))
            {
                var changed = false;
                lock (_stateGate)
                {
                    if (index >= 0 && index < _customizationSources.Count)
                    {
                        ToggleCustomizationSourceLocked(_customizationSources[index].StableId);
                        changed = true;
                    }
                }
                if (changed) PushCustomizationCard();
            }
            return;
        }

        if (args.Verb.StartsWith(expandPrefix, StringComparison.Ordinal))
        {
            var articleId = args.Verb[expandPrefix.Length..];
            var changed = false;
            lock (_stateGate)
            {
                if (_articles.Any(x => x.Id == articleId))
                {
                    MarkArticleReadLocked(articleId);
                    _state = _state with { ExpandedArticleId = articleId };
                    changed = true;
                }
            }
            if (changed) PushCurrentCard();
            return;
        }

        if (args.Verb.StartsWith(openPrefix, StringComparison.Ordinal))
        {
            var articleId = args.Verb[openPrefix.Length..];
            FeedArticle? article;
            lock (_stateGate) { article = _articles.FirstOrDefault(x => x.Id == articleId); }
            if (article is not null && Uri.TryCreate(article.Url, UriKind.Absolute, out var uri) &&
                (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            {
                try
                {
                    Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true });
                    lock (_stateGate) { MarkArticleReadLocked(articleId); }
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
        IReadOnlyList<FeedArticle> articles;
        IReadOnlyList<string> errors;
        int visibleFeedCount;
        WidgetState state;
        DateTimeOffset updatedAt;
        WidgetSize size;
        bool customizing;
        lock (_stateGate)
        {
            if (_disposed) return;
            customizing = _isCustomizing;
            articles = _articles;
            errors = _feedErrorLabels;
            visibleFeedCount = _visibleFeedCount;
            state = _state;
            updatedAt = _updatedAt;
            size = _size;
        }
        if (customizing)
        {
            PushCustomizationCard();
            return;
        }
        var options = new WidgetUpdateRequestOptions(_id)
        {
            Template = WidgetCardRenderer.Render(articles, errors, visibleFeedCount, state, updatedAt, size),
            Data = "{}",
            CustomState = JsonSerializer.Serialize(state)
        };
        WidgetManager.GetDefault().UpdateWidget(options);
    }

    public void Dispose()
    {
        Timer? timer;
        lock (_lifecycleGate)
        {
            if (_disposed) return;
            _disposed = true;
            timer = _timer;
            _timer = null;
        }

        if (timer is not null)
        {
            using var drained = new ManualResetEvent(false);
            if (timer.Dispose(drained)) drained.WaitOne();
        }

        _refreshGate.Wait();
        _refreshGate.Release();
        _refreshGate.Dispose();
    }

    private void MarkArticleReadLocked(string articleId)
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

    private void ToggleCustomizationSourceLocked(string feedId)
    {
        MigrateLegacyFeedSelectionLocked();
        var selected = _state.SelectedFeedIds is null
            ? new HashSet<string>(_customizationSources.Select(source => source.StableId), StringComparer.Ordinal)
            : new HashSet<string>(_state.SelectedFeedIds, StringComparer.Ordinal);

        if (!selected.Add(feedId)) selected.Remove(feedId);
        _state = _state with
        {
            SelectedFeedUrls = null,
            SelectedFeedIds = selected.OrderBy(value => value, StringComparer.Ordinal).ToList()
        };
    }

    private void MigrateLegacyFeedSelection()
    {
        lock (_stateGate) { MigrateLegacyFeedSelectionLocked(); }
    }

    private void MigrateLegacyFeedSelectionLocked()
    {
        if (_state.SelectedFeedIds is not null || _state.SelectedFeedUrls is null) return;
        _state = _state with
        {
            SelectedFeedIds = _state.SelectedFeedUrls.Select(FeedIdentity.FromUrl)
                .Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).ToList(),
            SelectedFeedUrls = null
        };
    }

    private void PushCustomizationCard()
    {
        IReadOnlyList<FeedSource> sources;
        WidgetState state;
        lock (_stateGate)
        {
            if (_disposed) return;
            sources = _customizationSources;
            state = _state;
        }
        var options = new WidgetUpdateRequestOptions(_id)
        {
            Template = WidgetCustomizationRenderer.Render(sources, state),
            Data = "{}",
            CustomState = JsonSerializer.Serialize(state)
        };
        WidgetManager.GetDefault().UpdateWidget(options);
    }

    private async Task UpdateRefreshIntervalAsync(CancellationToken cancellationToken)
    {
        var settings = await _settingsStore.LoadAsync(cancellationToken);
        var nextInterval = TimeSpan.FromMinutes(settings.RefreshIntervalMinutes);
        if (nextInterval == _refreshInterval) return;

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
        if (string.IsNullOrWhiteSpace(customState)) return new WidgetState();

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
