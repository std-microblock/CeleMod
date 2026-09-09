using System.Reflection;

// The embedded Android host writes to logcat, not a terminal. Mods may still
// save/set/restore Console colors while logging (e.g. ChroniaHelper.Load).
// Emulate only that state; leave text output and unrelated exceptions alone.
internal static class ConsoleColors
{
    private static int foreground = (int)ConsoleColor.Gray;
    private static int background = (int)ConsoleColor.Black;
    private static bool installed;

    internal static void Install()
    {
        if (installed) return;
        var console = typeof(Console);
        var foregroundProperty = console.GetProperty(nameof(Console.ForegroundColor))!;
        var backgroundProperty = console.GetProperty(nameof(Console.BackgroundColor))!;
        StartupHook.Patch(foregroundProperty.GetMethod!, nameof(GetForeground), typeof(ConsoleColors));
        StartupHook.Patch(foregroundProperty.SetMethod!, nameof(SetForeground), typeof(ConsoleColors));
        StartupHook.Patch(backgroundProperty.GetMethod!, nameof(GetBackground), typeof(ConsoleColors));
        StartupHook.Patch(backgroundProperty.SetMethod!, nameof(SetBackground), typeof(ConsoleColors));
        StartupHook.Patch(console.GetMethod(nameof(Console.ResetColor), BindingFlags.Public | BindingFlags.Static)!,
            nameof(Reset), typeof(ConsoleColors));
        installed = true;
        Console.WriteLine("[CeleMod] Android console color compatibility installed.");
    }

    private static bool GetForeground(ref ConsoleColor __result)
    {
        __result = (ConsoleColor)Volatile.Read(ref foreground);
        return false;
    }

    private static bool GetBackground(ref ConsoleColor __result)
    {
        __result = (ConsoleColor)Volatile.Read(ref background);
        return false;
    }

    private static bool SetForeground(ConsoleColor __0)
    {
        Validate(__0);
        Volatile.Write(ref foreground, (int)__0);
        return false;
    }

    private static bool SetBackground(ConsoleColor __0)
    {
        Validate(__0);
        Volatile.Write(ref background, (int)__0);
        return false;
    }

    private static void Validate(ConsoleColor value)
    {
        // Retain Console's argument validation instead of hiding mod errors.
        if ((uint)value > (uint)ConsoleColor.White)
            throw new ArgumentOutOfRangeException(nameof(value), value, "Invalid console color.");
    }

    private static bool Reset()
    {
        Volatile.Write(ref foreground, (int)ConsoleColor.Gray);
        Volatile.Write(ref background, (int)ConsoleColor.Black);
        return false;
    }
}
