using Feedboard.Models;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Feedboard.Widgets;

public static class WidgetCardRenderer
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    public static string Render(IReadOnlyList<FeedArticle> articles, WidgetState state, DateTimeOffset updatedAt)
    {
        var body = new JsonArray
        {
            Section("small", articles.Take(2), state, updatedAt, showThumbnails: false),
            Section("medium", articles.Take(4), state, updatedAt, showThumbnails: true),
            Section("large", articles.Take(6), state, updatedAt, showThumbnails: true)
        };

        var card = new JsonObject
        {
            ["type"] = "AdaptiveCard",
            ["$schema"] = "http://adaptivecards.io/schemas/adaptive-card.json",
            ["version"] = "1.6",
            ["body"] = body
        };

        return card.ToJsonString(JsonOptions);
    }

    private static JsonObject Section(string size, IEnumerable<FeedArticle> articles, WidgetState state, DateTimeOffset updatedAt, bool showThumbnails)
    {
        var items = articles.ToList();
        var body = new JsonArray
        {
            new JsonObject
            {
                ["type"] = "ColumnSet",
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
                                ["text"] = "Feedboard",
                                ["weight"] = "Bolder",
                                ["size"] = "Medium",
                                ["wrap"] = true
                            }
                        }
                    },
                    new JsonObject
                    {
                        ["type"] = "Column",
                        ["width"] = "auto",
                        ["verticalContentAlignment"] = "Center",
                        ["items"] = new JsonArray
                        {
                            new JsonObject
                            {
                                ["type"] = "TextBlock",
                                ["text"] = updatedAt.LocalDateTime.ToString("HH:mm"),
                                ["isSubtle"] = true,
                                ["size"] = "Small"
                            }
                        }
                    }
                }
            }
        };

        if (items.Count == 0)
        {
            body.Add(new JsonObject
            {
                ["type"] = "TextBlock",
                ["text"] = "No feeds yet. Add one with the Feedboard app/CLI.",
                ["wrap"] = true,
                ["isSubtle"] = true
            });
        }
        else
        {
            foreach (var article in items)
            {
                body.Add(ArticleRow(article, state.ExpandedArticleId == article.Id, showThumbnails));
            }

            body.Add(new JsonObject
            {
                ["type"] = "TextBlock",
                ["text"] = "Tap once for details · tap the expanded item to open",
                ["size"] = "Small",
                ["isSubtle"] = true,
                ["wrap"] = true,
                ["spacing"] = "Small"
            });
        }

        return new JsonObject
        {
            ["type"] = "Container",
            ["$when"] = $"${{$host.widgetSize==\"{size}\"}}",
            ["items"] = body,
            ["spacing"] = "None"
        };
    }

    private static JsonObject ArticleRow(FeedArticle article, bool expanded, bool showThumbnail)
    {
        var imageUrl = showThumbnail && !string.IsNullOrWhiteSpace(article.ThumbnailUrl)
            ? article.ThumbnailUrl
            : article.FaviconUrl;

        var rowItems = new JsonArray
        {
            new JsonObject
            {
                ["type"] = "ColumnSet",
                ["columns"] = new JsonArray
                {
                    new JsonObject
                    {
                        ["type"] = "Column",
                        ["width"] = "auto",
                        ["verticalContentAlignment"] = "Center",
                        ["items"] = string.IsNullOrWhiteSpace(imageUrl)
                            ? new JsonArray()
                            : new JsonArray
                            {
                                new JsonObject
                                {
                                    ["type"] = "Image",
                                    ["url"] = imageUrl,
                                    ["size"] = "Small",
                                    ["style"] = "Default",
                                    ["altText"] = article.FeedTitle
                                }
                            }
                    },
                    new JsonObject
                    {
                        ["type"] = "Column",
                        ["width"] = "stretch",
                        ["items"] = new JsonArray
                        {
                            new JsonObject
                            {
                                ["type"] = "TextBlock",
                                ["text"] = article.Title,
                                ["weight"] = "Bolder",
                                ["wrap"] = true,
                                ["maxLines"] = expanded ? 4 : 2
                            },
                            new JsonObject
                            {
                                ["type"] = "TextBlock",
                                ["text"] = Meta(article),
                                ["isSubtle"] = true,
                                ["size"] = "Small",
                                ["spacing"] = "None",
                                ["wrap"] = true
                            }
                        }
                    }
                }
            }
        };

        if (expanded && !string.IsNullOrWhiteSpace(article.Summary))
        {
            rowItems.Add(new JsonObject
            {
                ["type"] = "TextBlock",
                ["text"] = article.Summary,
                ["wrap"] = true,
                ["maxLines"] = 5,
                ["spacing"] = "Small"
            });
        }

        return new JsonObject
        {
            ["type"] = "Container",
            ["separator"] = true,
            ["spacing"] = "Small",
            ["items"] = rowItems,
            ["selectAction"] = new JsonObject
            {
                ["type"] = "Action.Execute",
                ["verb"] = expanded ? $"open:{article.Id}" : $"expand:{article.Id}",
                ["title"] = expanded ? "Open article" : "Show details"
            }
        };
    }

    private static string Meta(FeedArticle article)
    {
        var date = article.Published?.LocalDateTime.ToString("dd MMM HH:mm");
        return string.IsNullOrWhiteSpace(date) ? article.FeedTitle : $"{article.FeedTitle} · {date}";
    }
}
