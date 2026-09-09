using System.Reflection;

// Join Everest's managed detour chain instead of replacing the native entrypoint.
// Harmony's raw detour can be silently superseded when a mod hooks the same method.
internal static class GameHooks
{
    private static readonly List<IDisposable> hooks = new();

    internal static void Add(MethodInfo source, string handler, Type owner, params Type[] types)
    {
        var target = owner.GetMethod(handler, BindingFlags.NonPublic | BindingFlags.Static)!;
        if (types.Length != 0) target = target.MakeGenericMethod(types);
        var hook = Assembly.Load("MonoMod.RuntimeDetour").GetType("MonoMod.RuntimeDetour.Hook", true)!;
        var constructor = hook.GetConstructor(new[] { typeof(MethodBase), typeof(MethodInfo) })
            ?? throw new MissingMethodException(hook.FullName, ".ctor(MethodBase, MethodInfo)");
        hooks.Add((IDisposable)constructor.Invoke(new object[] { source, target }));
    }
}
