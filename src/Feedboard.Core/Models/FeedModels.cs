using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;

namespace Feedboard.Models;

public sealed record FeedSource(
    string Url,
    string? Title = null,
    bool Enabled = true,
    string? Id = null)
{
    [JsonIgnore]
    public string StableId => string.IsNullOrWhiteSpace(Id) ? FeedIdentity.FromUrl(Url) : Id;
}

public static class FeedIdentity
{
    public static string FromUrl(string url)
    {
        var normalized = Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.ToString() : url.Trim();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(normalized));
        return Convert.ToHexString(hash.AsSpan(0, 16)).ToLowerInvariant();
    }
}

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
    IReadOnlyList<string>? SelectedFeedUrls = null,
    IReadOnlyList<string>? ReadArticleIds = null,
    IReadOnlyList<string>? SelectedFeedIds = null);