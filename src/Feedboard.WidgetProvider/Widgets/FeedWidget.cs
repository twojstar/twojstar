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

    private static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(15);
    private readonly string _id;
    private readonly FeedStore _store = new();
    private readonly FeedClient _client = new();
    private readonly SemaphoreSlim _refreshGate = new(1, 1);
    private readonly object _lifecycleGate = new();

    private IReadOnlyList<FeedArticle> _articles = Array.Empty<FeedArticle>();
    private WidgetState _state;
    private WidgetSize _size;
    private Timer? _timer;
    private DateTimeOffset _updatedAt = DateTimeOffset.Now;
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

            _timer ??= new Timer(_ => RefreshTimerCallback(), null, TimeSpan.Zero, RefreshInterval);
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

    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed || !await _refreshGate.WaitAsync(0, cancellationToken))
        {
            return;
        }

        try
        {
            var sources = await _store.LoadAsync(cancellationToken);
            _articles = await _client.LoadAsync(sources, cancellationToken);
            _updatedAt = DateTimeOffset.Now;

            if (_state.ExpandedArticleId is not null && _articles.All(x => x.Id != _state.ExpandedArticleId))
            {
                _state = new WidgetState();
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

    public void UpdateContext(WidgetSize size)
    {
        var previousSize = _size;
        _size = size;

        if ((int)size < (int)previousSize && _state.ExpandedArticleId is not null)
        {
            _state = new WidgetState();
        }

        PushCurrentCard();
    }

    public void OnActionInvoked(WidgetActionInvokedArgs args)
    {
        const string expandPrefix = "expand:";
        const string openPrefix = "open:";

        if (args.Verb.StartsWith(expandPrefix, StringComparison.Ordinal))
        {
            var articleId = args.Verb[expandPrefix.Length..];
            if (_articles.Any(x => x.Id == articleId))
            {
                _state = new WidgetState(articleId);
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
                Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true });
            }
        }
    }

    public void PushCurrentCard()
    {
        if (_disposed)
        {
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
