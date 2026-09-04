using Feedboard.Models;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Feedboard.Widgets;

public static class WidgetCustomizationRenderer
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static string Render(IReadOnlyList<FeedSource> sources, WidgetState state)
    {
        var selected = state.SelectedFeedUrls is null
            ? null
            : new HashSet<string>(state.SelectedFeedUrls, StringComparer.OrdinalIgnoreCase);
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

        for (var index = 0; index < sources.Count; index++)
        {
            var source = sources[index];
            var isSelected = selected is null || selected.Contains(source.Url);
            body.Add(new JsonObject
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
                                ["actions"] = new JsonArray
                                {
                                    new JsonObject
                                    {
                                        ["type"] = "Action.Execute",
                                        ["verb"] = $"customize:toggle:{index}",
                                        ["title"] = isSelected ? "On" : "Off"
                                    }
                                }
                            }
                        }
                    }
                }
            });
        }

        body.Add(new JsonObject
        {
            ["type"] = "ActionSet",
            ["actions"] = new JsonArray
            {
                new JsonObject
                {
                    ["type"] = "Action.Execute",
                    ["verb"] = "customize:all",
                    ["title"] = "Use all feeds"
                },
                new JsonObject
                {
                    ["type"] = "Action.Execute",
                    ["verb"] = "customize:done",
                    ["title"] = "Done"
                }
            }
        });

        return new JsonObject
        {
            ["type"] = "AdaptiveCard",
            ["$schema"] = "http://adaptivecards.io/schemas/adaptive-card.json",
            ["version"] = "1.6",
            ["body"] = body
        }.ToJsonString(JsonOptions);
    }
}
