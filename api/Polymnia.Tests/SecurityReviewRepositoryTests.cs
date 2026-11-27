using System.Text.RegularExpressions;

namespace Polymnia.Tests;

/// <summary>
/// Supply-chain and secret-hygiene rules of the repository itself (issue #20), kept as tests so that they cannot
/// silently regress: pinned actions and base images, least-privilege workflows, ignored key material, audited packages.
/// </summary>
public sealed partial class SecurityReviewRepositoryTests
{
    private static string Root
    {
        get
        {
            DirectoryInfo? dir = new(AppContext.BaseDirectory);
            while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
            {
                dir = dir.Parent;
            }

            return dir?.FullName ?? throw new InvalidOperationException("Repository root not found.");
        }
    }

    private static string Read(params string[] relative) => File.ReadAllText(Path.Combine([Root, .. relative]));

    private static IEnumerable<string> Workflows() =>
        Directory.EnumerateFiles(Path.Combine(Root, ".github", "workflows"), "*.yml");

    [Fact]
    public void Every_action_is_pinned_to_a_full_commit_sha()
    {
        foreach (string file in Workflows())
        {
            foreach (Match use in UsesRegex().Matches(File.ReadAllText(file)))
            {
                Assert.True(
                    Sha().IsMatch(use.Groups["ref"].Value),
                    $"{Path.GetFileName(file)}: '{use.Value.Trim()}' is not pinned to a commit SHA.");
            }
        }
    }

    [Fact]
    public void Every_workflow_declares_read_only_permissions_at_the_top()
    {
        foreach (string file in Workflows())
        {
            string text = File.ReadAllText(file);
            Assert.Matches(@"(?m)^permissions:\s*\r?\n\s+contents: read\s*$", text);
            Assert.DoesNotContain("pull_request_target", text, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void The_release_refuses_a_commit_whose_ci_has_not_passed()
    {
        string release = Read(".github", "workflows", "release.yml");
        Assert.Contains("check-runs", release, StringComparison.Ordinal);
        Assert.Contains("checks: read", release, StringComparison.Ordinal);
        Assert.Contains("attest-build-provenance", release, StringComparison.Ordinal);
    }

    [Fact]
    public void Container_base_images_are_pinned_by_digest_and_the_runtime_is_not_root()
    {
        string dockerfile = Read("Dockerfile");
        foreach (Match from in FromRegex().Matches(dockerfile))
        {
            Assert.Matches("@sha256:[0-9a-f]{64}", from.Value);
        }

        Assert.Contains("USER $APP_UID", dockerfile, StringComparison.Ordinal);
        Assert.Contains("chiseled", dockerfile, StringComparison.Ordinal);

        string compose = Read("docker-compose.yml");
        Assert.Matches("(?s)image: postgres:[^\\s]+@sha256:[0-9a-f]{64}", compose);
        Assert.Equal(2, NoNewPrivileges().Count(compose)); // the application anchor and the database
        Assert.Contains("read_only: true", compose, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("*.pfx")]
    [InlineData("*.p12")]
    [InlineData("*.pem")]
    [InlineData("*.key")]
    [InlineData(".env")]
    [InlineData("secrets/")]
    public void Key_material_and_local_configuration_are_git_ignored(string pattern)
    {
        Assert.Contains(pattern, Read(".gitignore").Split('\n', StringSplitOptions.TrimEntries));
    }

    [Fact]
    public void The_environment_example_holds_placeholders_only()
    {
        string example = Read(".env.example");
        Assert.DoesNotMatch(@"GOCSPX-", example);
        Assert.DoesNotMatch(@"\d{6,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com", example);
        Assert.Contains("POLYMNIA_GOOGLE_CLIENT_SECRET=replace-with-your-client-secret", example, StringComparison.Ordinal);
    }

    [Fact]
    public void Vulnerable_packages_fail_the_build()
    {
        string props = Read("api", "Directory.Build.props");
        Assert.Contains("<NuGetAuditMode>all</NuGetAuditMode>", props, StringComparison.Ordinal);
        Assert.Contains("<NuGetAuditLevel>low</NuGetAuditLevel>", props, StringComparison.Ordinal);
        Assert.Contains("NU1901;NU1902;NU1903;NU1904", props, StringComparison.Ordinal);
    }

    [Fact]
    public void Dependabot_watches_every_ecosystem()
    {
        string dependabot = Read(".github", "dependabot.yml");
        foreach (string ecosystem in new[] { "npm", "nuget", "github-actions", "docker" })
        {
            Assert.Contains($"package-ecosystem: {ecosystem}", dependabot, StringComparison.Ordinal);
        }
    }

    [GeneratedRegex(@"(?m)^\s*-?\s*uses:\s*(?<name>[^@\s]+)@(?<ref>[^\s#]+)")]
    private static partial Regex UsesRegex();

    [GeneratedRegex("^[0-9a-f]{40}$")]
    private static partial Regex Sha();

    [GeneratedRegex(@"(?m)^FROM .+$")]
    private static partial Regex FromRegex();

    [GeneratedRegex("no-new-privileges:true")]
    private static partial Regex NoNewPrivileges();
}
