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
            Header(updatedAt, profile.CompactHeader)
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
                    profile.CompactRows,
                    profile.TitleLines,
                    profile.SummaryLines));
            }

            if (profile.ShowInteractionHint)
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

    private static JsonObject Header(DateTimeOffset updatedAt, bool compact) => new()
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
                        ["size"] = compact ? "Default" : "Medium",
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
        bool compact,
        int titleLines,
        int summaryLines)
    {
        var hasThumbnail = showThumbnail && !string.IsNullOrWhiteSpace(article.ThumbnailUrl);
        var imageUrl = hasThumbnail ? article.ThumbnailUrl : article.FaviconUrl;
        var markerItems = isRead
            ? new JsonArray()
            : new JsonArray
            {
                new JsonObject
                {
                    ["type"] = "TextBlock",
                    ["text"] = "●",
                    ["size"] = "Small",
                    ["spacing"] = "None"
                }
            };
        var columns = new JsonArray
        {
            new JsonObject
            {
                ["type"] = "Column",
                ["width"] = "auto",
                ["verticalContentAlignment"] = "Center",
                ["items"] = markerItems
            }
        };

        if (!string.IsNullOrWhiteSpace(imageUrl))
        {
            columns.Add(new JsonObject
            {
                ["type"] = "Column",
                ["width"] = "auto",
                ["verticalContentAlignment"] = "Center",
                ["items"] = new JsonArray
                {
                    new JsonObject
                    {
                        ["type"] = "Image",
                        ["url"] = imageUrl,
                        ["size"] = "Small",
                        ["style"] = "Default",
                        ["altText"] = hasThumbnail
                            ? $"Thumbnail for {article.Title}"
                            : $"{article.FeedTitle} feed icon"
                    }
                }
            });
        }

        columns.Add(new JsonObject
        {
            ["type"] = "Column",
            ["width"] = "stretch",
            ["items"] = new JsonArray
            {
                new JsonObject
                {
                    ["type"] = "TextBlock",
                    ["text"] = article.Title,
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
        });

        var rowItems = new JsonArray
        {
            new JsonObject
            {
                ["type"] = "ColumnSet",
                ["spacing"] = "None",
                ["columns"] = columns
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
            ["spacing"] = compact ? "None" : "Small",
            ["items"] = rowItems,
            ["selectAction"] = new JsonObject
            {
                ["type"] = "Action.Execute",
                ["verb"] = expanded ? $"open:{article.Id}" : $"expand:{article.Id}",
                ["title"] = expanded
                    ? $"Open {article.Title}"
                    : $"Show details for {article.Title}"
            }
        };
    }

    private static string Meta(FeedArticle article)
    {
        var date = article.Published?.LocalDateTime.ToString("dd MMM HH:mm");
        return string.IsNullOrWhiteSpace(date) ? article.FeedTitle : $"{article.FeedTitle} · {date}";
    }

    private sealed record LayoutProfile(
        int ArticleLimit,
        bool ShowThumbnails,
        bool CompactHeader,
        bool CompactRows,
        bool ShowInteractionHint,
        int TitleLines,
        int SummaryLines)
    {
        public static LayoutProfile For(WidgetSize size) => size switch
        {
            WidgetSize.Small => new LayoutProfile(2, false, true, true, false, 2, 1),
            WidgetSize.Medium => new LayoutProfile(3, true, false, false, false, 2, 2),
            WidgetSize.Large => new LayoutProfile(5, true, false, false, true, 2, 4),
            _ => new LayoutProfile(3, true, false, false, false, 2, 2)
        };
    }
}
