namespace Polymnia.Core.Scores;

/// <summary>The authenticated caller. <see cref="UserId"/> is <c>null</c> when nobody is signed in.</summary>
public interface ICurrentUser
{
    Guid? UserId { get; }
}
