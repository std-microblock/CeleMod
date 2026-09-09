namespace CeleMod.Steam;

internal static class CloudAddress
{
    internal static Uri Url(string host, string path)
    {
        // Never expose signed paths, downgrade HTTPS, or follow redirects with
        // Steam's authorization headers. Limit third-party hosts to Steam Cloud accounts.
        if (!Uri.TryCreate("https://" + host + path, UriKind.Absolute, out var uri) ||
            uri.UserInfo != "" || uri.Port != 443 || uri.HostNameType != UriHostNameType.Dns ||
            !path.StartsWith('/') ||
            (!string.Equals(host, uri.Authority, StringComparison.OrdinalIgnoreCase) &&
             !string.Equals(host, uri.Host + ":443", StringComparison.OrdinalIgnoreCase)) ||
            !AllowedHost(uri.Host))
            throw new InvalidDataException("Steam 返回了不支持的云存储地址（主机：" +
                (uri?.Host ?? "无效") + "），已停止传输。");
        return uri;
    }

    private static bool AllowedHost(string host) =>
        new[] { "steamcontent.com", "steamusercontent.com", "steampowered.com", "steamstatic.com", "amazonaws.com" }
            .Any(domain => host == domain || host.EndsWith("." + domain, StringComparison.OrdinalIgnoreCase)) ||
        System.Text.RegularExpressions.Regex.IsMatch(host, @"^steamcloud[a-z0-9]*\.blob\.core\.windows\.net$",
            System.Text.RegularExpressions.RegexOptions.CultureInvariant) ||
        System.Text.RegularExpressions.Regex.IsMatch(host, @"^steamcloud(?:-[a-z0-9]+)*\.storage\.googleapis\.com$",
            System.Text.RegularExpressions.RegexOptions.CultureInvariant) ||
        System.Text.RegularExpressions.Regex.IsMatch(host, @"^steamcloud(?:-[a-z0-9]+)*\.oss-(?:accelerate|[a-z0-9]+(?:-[a-z0-9]+)*)\.aliyuncs\.com$",
            System.Text.RegularExpressions.RegexOptions.CultureInvariant);
}
