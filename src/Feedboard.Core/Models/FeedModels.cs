namespace Feedboard.Models;

public sealed record FeedSource(
    string Url,
    string? Title = null,
    bool Enabled = true);

public sealed record FeedArticle(
    string Id,
    string FeedTitle,
    string Title,
    string Url,
    string? Summary,
    DateTimeOffset? Published,
    string? FaviconUrl,
    string? ThumbnailUrl);

public sealed record WidgetState(
    string? ExpandedArticleId = null,
    IReadOnlyList<string>? SelectedFeedUrls = null);
