using Feedboard.Models;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Feedboard.Widgets;

public static class WidgetCustomizationRenderer
{
    internal const int PageSize = 6;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static string Render(
        IReadOnlyList<FeedSource> sources,
        WidgetState state,
        int requestedPage,
        bool isLoading,
        bool loadFailed)
    {
        var selectedValues = state.SelectedFeedIds ?? state.SelectedFeedUrls?.Select(FeedIdentity.FromUrl).ToList();
        var selected = selectedValues is null
            ? null
            : new HashSet<string>(selectedValues, StringComparer.Ordinal);
        var totalPages = Math.Max(1, (sources.Count + PageSize - 1) / PageSize);
        var page = Math.Clamp(requestedPage, 0, totalPages - 1);
        var body = new JsonArray
        {
            new JsonObject
            {
                ["type"] = "TextBlock",
                ["text"] = "Choose feeds",
                ["weight"] = "Bolder",
                ["size"] = "Medium"
            },
            new JsonObject
            {
                ["type"] = "TextBlock",
                ["text"] = "Pick which enabled feeds this widget should show.",
                ["wrap"] = true,
                ["isSubtle"] = true
            }
        };

        if (isLoading)
        {
            AddStatus(body, "Loading feeds...");
        }
        else if (loadFailed)
        {
            AddStatus(body, "Could not load feeds. Close customization and try again.");
        }
        else if (sources.Count == 0)
        {
            AddStatus(body, "No enabled feeds. Enable a feed in Feedboard Settings first.");
        }
        else
        {
            var first = page * PageSize;
            var last = Math.Min(first + PageSize, sources.Count);
            body.Add(new JsonObject
            {
                ["type"] = "TextBlock",
                ["text"] = $"Feeds {first + 1}-{last} of {sources.Count}",
                ["isSubtle"] = true,
                ["size"] = "Small"
            });

            for (var index = first; index < last; index++)
            {
                var source = sources[index];
                var isSelected = selected is null || selected.Contains(source.StableId);
                body.Add(FeedRow(source, isSelected));
            }

            if (totalPages > 1)
            {
                var actions = new JsonArray();
                if (page > 0) actions.Add(Execute("customize:page:prev", "Previous"));
                if (page + 1 < totalPages) actions.Add(Execute("customize:page:next", "Next"));
                body.Add(new JsonObject { ["type"] = "ActionSet", ["actions"] = actions });
            }
        }

        var footerActions = new JsonArray();
        if (!isLoading && !loadFailed && sources.Count > 0)
            footerActions.Add(Execute("customize:all", "Use all feeds"));
        footerActions.Add(Execute("customize:done", "Done"));
        body.Add(new JsonObject { ["type"] = "ActionSet", ["actions"] = footerActions });

        return new JsonObject
        {
            ["type"] = "AdaptiveCard",
            ["$schema"] = "http://adaptivecards.io/schemas/adaptive-card.json",
            ["version"] = "1.6",
            ["body"] = body
        }.ToJsonString(JsonOptions);
    }

    private static JsonObject FeedRow(FeedSource source, bool isSelected) => new()
    {
        ["type"] = "ColumnSet",
        ["separator"] = true,
        ["columns"] = new JsonArray
        {
            new JsonObject
            {
                ["type"] = "Column",
                ["width"] = "stretch",
                ["items"] = new JsonArray
                {
                    new JsonObject
                    {
                        ["type"] = "TextBlock",
                        ["text"] = source.Title ?? source.Url,
                        ["wrap"] = true,
                        ["maxLines"] = 2
                    }
                }
            },
            new JsonObject
            {
                ["type"] = "Column",
                ["width"] = "auto",
                ["items"] = new JsonArray
                {
                    new JsonObject
                    {
                        ["type"] = "ActionSet",
                        ["actions"] = new JsonArray { Execute($"customize:toggle:{source.StableId}", isSelected ? "On" : "Off") }
                    }
                }
            }
        }
    };

    private static JsonObject Execute(string verb, string title) => new()
    {
        ["type"] = "Action.Execute",
        ["verb"] = verb,
        ["title"] = title
    };

    private static void AddStatus(JsonArray body, string text) => body.Add(new JsonObject
    {
        ["type"] = "TextBlock",
        ["text"] = text,
        ["wrap"] = true,
        ["isSubtle"] = true
    });
}
