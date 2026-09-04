using Feedboard.Models;
using Microsoft.Windows.Widgets;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Feedboard.Widgets;

public static class WidgetCardRenderer
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    public static string Render(
        IReadOnlyList<FeedArticle> articles,
        IReadOnlyList<string> feedErrorLabels,
        int visibleFeedCount,
        WidgetState state,
        DateTimeOffset updatedAt,
        WidgetSize size)
    {
        var profile = LayoutProfile.For(size);
        var readIds = state.ReadArticleIds is null
            ? null
            : new HashSet<string>(state.ReadArticleIds, StringComparer.Ordinal);
        var visibleArticles = articles
            .OrderBy(article => readIds?.Contains(article.Id) == true ? 1 : 0)
            .ThenByDescending(article => article.Published ?? DateTimeOffset.MinValue)
            .Take(profile.ArticleLimit)
            .ToList();
        var body = new JsonArray
        {
            Header(updatedAt)
        };

        if (visibleArticles.Count == 0)
        {
            body.Add(EmptyState(feedErrorLabels.Count, visibleFeedCount, size));
        }
        else
        {
            foreach (var article in visibleArticles)
            {
                body.Add(ArticleRow(
                    article,
                    state.ExpandedArticleId == article.Id,
                    readIds?.Contains(article.Id) == true,
                    profile.ShowThumbnails,
                    profile.TitleLines,
                    profile.SummaryLines));
            }

            if (size != WidgetSize.Small)
            {
                body.Add(new JsonObject
                {
                    ["type"] = "TextBlock",
                    ["text"] = "Tap a headline for details · tap again to open",
                    ["size"] = "Small",
                    ["isSubtle"] = true,
                    ["wrap"] = true,
                    ["spacing"] = "Small"
                });
            }
        }

        if (feedErrorLabels.Count > 0 && visibleArticles.Count > 0)
        {
            body.Add(ErrorStatus(feedErrorLabels, size));
        }

        var card = new JsonObject
        {
            ["type"] = "AdaptiveCard",
            ["$schema"] = "http://adaptivecards.io/schemas/adaptive-card.json",
            ["version"] = "1.6",
            ["body"] = body
        };

        return card.ToJsonString(JsonOptions);
    }

    private static JsonObject EmptyState(int feedErrorCount, int visibleFeedCount, WidgetSize size)
    {
        var noFeeds = visibleFeedCount == 0;
        var allFeedsRetrying = visibleFeedCount > 0 && feedErrorCount >= visibleFeedCount;
        var title = noFeeds
            ? "Your Feedboard is empty"
            : allFeedsRetrying
                ? "Feeds are taking a break"
                : "No headlines right now";
        var detail = noFeeds
            ? size == WidgetSize.Small
                ? "Add a feed in Feedboard."
                : "Add or import a feed in the Feedboard app to start seeing headlines here."
            : allFeedsRetrying
                ? size == WidgetSize.Small
                    ? "We'll retry automatically."
                    : "Cached headlines aren't available yet. Feedboard will retry automatically."
                : size == WidgetSize.Small
                    ? "Check back after the next refresh."
                    : "Your feeds are configured and healthy. Check back after the next refresh.";

        return new JsonObject
        {
            ["type"] = "Container",
            ["spacing"] = "Medium",
            ["items"] = new JsonArray
            {
                new JsonObject
                {
                    ["type"] = "TextBlock",
                    ["text"] = allFeedsRetrying ? "⚠" : "◌",
                    ["size"] = "Large",
                    ["horizontalAlignment"] = "Center",
                    ["spacing"] = "Small"
                },
                new JsonObject
                {
                    ["type"] = "TextBlock",
                    ["text"] = title,
                    ["weight"] = "Bolder",
                    ["horizontalAlignment"] = "Center",
                    ["wrap"] = true,
                    ["spacing"] = "Small"
                },
                new JsonObject
                {
                    ["type"] = "TextBlock",
                    ["text"] = detail,
                    ["isSubtle"] = true,
                    ["size"] = "Small",
                    ["horizontalAlignment"] = "Center",
                    ["wrap"] = true,
                    ["spacing"] = "Small"
                }
            }
        };
    }

    private static JsonObject ErrorStatus(IReadOnlyList<string> feedErrorLabels, WidgetSize size)
    {
        var text = size == WidgetSize.Small
            ? $"⚠ {feedErrorLabels.Count} feed{(feedErrorLabels.Count == 1 ? "" : "s")} retrying"
            : $"⚠ Retrying: {string.Join(", ", feedErrorLabels.Take(2))}{(feedErrorLabels.Count > 2 ? $" +{feedErrorLabels.Count - 2}" : string.Empty)}";
        return new JsonObject
        {
            ["type"] = "TextBlock",
            ["text"] = text,
            ["size"] = "Small",
            ["isSubtle"] = true,
            ["wrap"] = true,
            ["spacing"] = "Small"
        };
    }

    private static JsonObject Header(DateTimeOffset updatedAt) => new()
    {
        ["type"] = "ColumnSet",
        ["spacing"] = "None",
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
    };

    private static JsonObject ArticleRow(
        FeedArticle article,
        bool expanded,
        bool isRead,
        bool showThumbnail,
        int titleLines,
        int summaryLines)
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
                                ["text"] = isRead ? article.Title : $"● {article.Title}",
                                ["weight"] = isRead ? "Default" : "Bolder",
                                ["isSubtle"] = isRead,
                                ["wrap"] = true,
                                ["maxLines"] = expanded ? titleLines + 1 : titleLines
                            },
                            new JsonObject
                            {
                                ["type"] = "TextBlock",
                                ["text"] = Meta(article),
                                ["isSubtle"] = true,
                                ["size"] = "Small",
                                ["spacing"] = "None",
                                ["wrap"] = true,
                                ["maxLines"] = 1
                            }
                        }
                    }
                }
            }
        };

        if (expanded && summaryLines > 0 && !string.IsNullOrWhiteSpace(article.Summary))
        {
            rowItems.Add(new JsonObject
            {
                ["type"] = "TextBlock",
                ["text"] = article.Summary,
                ["wrap"] = true,
                ["maxLines"] = summaryLines,
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

    private sealed record LayoutProfile(int ArticleLimit, bool ShowThumbnails, int TitleLines, int SummaryLines)
    {
        public static LayoutProfile For(WidgetSize size) => size switch
        {
            WidgetSize.Small => new LayoutProfile(1, false, 2, 2),
            WidgetSize.Medium => new LayoutProfile(2, true, 2, 3),
            WidgetSize.Large => new LayoutProfile(4, true, 2, 5),
            _ => new LayoutProfile(2, true, 2, 3)
        };
    }
}
