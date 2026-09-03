using Feedboard.Interop;
using Feedboard.Widgets;
using Microsoft.Windows.Widgets.Providers;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;

namespace Feedboard;

[ComVisible(true)]
[ComDefaultInterface(typeof(IWidgetProvider))]
[Guid("6890AE95-9824-4DD2-BF3B-B0E3724639F2")]
public sealed class WidgetProvider : IWidgetProvider
{
    private static readonly ConcurrentDictionary<string, FeedWidget> Widgets = new();
    private static readonly object LifecycleGate = new();
    private static int _recovered;

    public WidgetProvider() => RecoverRunningWidgets();

    public void CreateWidget(WidgetContext widgetContext)
    {
        if (!string.Equals(widgetContext.DefinitionId, FeedWidget.DefinitionId, StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Unknown widget definition: {widgetContext.DefinitionId}");
        }

        FeedWidget widget;
        lock (LifecycleGate)
        {
            widget = new FeedWidget(widgetContext.Id, string.Empty);
            Widgets[widgetContext.Id] = widget;
        }

        widget.RefreshAsync().GetAwaiter().GetResult();
    }

    public void DeleteWidget(string widgetId, string _) => RemoveAndDispose(widgetId);

    public void OnActionInvoked(WidgetActionInvokedArgs actionInvokedArgs)
    {
        if (Widgets.TryGetValue(actionInvokedArgs.WidgetContext.Id, out var widget))
        {
            widget.OnActionInvoked(actionInvokedArgs);
        }
    }

    public void OnWidgetContextChanged(WidgetContextChangedArgs contextChangedArgs)
    {
        if (Widgets.TryGetValue(contextChangedArgs.WidgetContext.Id, out var widget))
        {
            widget.PushCurrentCard();
        }
    }

    public void Activate(WidgetContext widgetContext)
    {
        if (Widgets.TryGetValue(widgetContext.Id, out var widget))
        {
            widget.Activate();
        }
    }

    public void Deactivate(string widgetId)
    {
        if (Widgets.TryGetValue(widgetId, out var widget))
        {
            widget.Deactivate();
        }
    }

    private static void RecoverRunningWidgets()
    {
        if (Interlocked.Exchange(ref _recovered, 1) != 0)
        {
            return;
        }

        try
        {
            var manager = WidgetManager.GetDefault();
            lock (LifecycleGate)
            {
                foreach (var info in manager.GetWidgetInfos())
                {
                    var context = info.WidgetContext;
                    if (!string.Equals(context.DefinitionId, FeedWidget.DefinitionId, StringComparison.Ordinal))
                    {
                        manager.DeleteWidget(context.Id);
                        continue;
                    }

                    Widgets.TryAdd(context.Id, new FeedWidget(context.Id, info.CustomState));
                }
            }
        }
        catch
        {
            // The Widgets host can be unavailable during ordinary app launch.
        }
    }

    private static void RemoveAndDispose(string widgetId)
    {
        FeedWidget? widget = null;
        lock (LifecycleGate)
        {
            Widgets.TryRemove(widgetId, out widget);
            if (Widgets.IsEmpty)
            {
                RegistrationManager<WidgetProvider>.RequestExit();
            }
        }

        widget?.Dispose();
    }
}
