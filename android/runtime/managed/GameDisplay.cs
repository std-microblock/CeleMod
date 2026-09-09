using System.Reflection;
using System.Runtime.InteropServices;

// Android cannot resize its SDL surface to a desktop window preset (e.g. 960x540).
// Match the backbuffer to the drawable BEFORE FNA creates/resets the device, so
// Monocle's normal viewport calculation supplies letterboxing instead of stretching.
internal static class GameDisplay
{
    internal static void Install()
    {
        try {
            var fna = Assembly.Load("FNA");
            var device = fna.GetType("Microsoft.Xna.Framework.Graphics.GraphicsDevice", true)!;
            var adapter = fna.GetType("Microsoft.Xna.Framework.Graphics.GraphicsAdapter", true)!;
            var profile = fna.GetType("Microsoft.Xna.Framework.Graphics.GraphicsProfile", true)!;
            var parameters = fna.GetType("Microsoft.Xna.Framework.Graphics.PresentationParameters", true)!;
            var constructor = device.GetConstructor(new[] { adapter, profile, parameters })
                ?? throw new MissingMethodException("GraphicsDevice constructor");
            var reset = device.GetMethod("Reset", new[] { parameters, adapter })
                ?? throw new MissingMethodException("GraphicsDevice.Reset");
            StartupHook.Patch(constructor, nameof(BeforeCreate), typeof(GameDisplay));
            StartupHook.Patch(reset, nameof(BeforeReset), typeof(GameDisplay));
            Console.WriteLine("[CeleMod] Android drawable/backbuffer sizing connected.");
        } catch (Exception e) {
            Console.WriteLine("[CeleMod] Android display adaptation unavailable: " + e);
        }
    }

    // Positional arguments also work with FNA builds using different parameter names.
    private static void BeforeCreate(object? __2) => MatchDrawable(__2);
    private static void BeforeReset(object? __0) => MatchDrawable(__0);

    private static void MatchDrawable(object? parameters)
    {
        if (parameters == null) return; // Preserve FNA's argument validation.
        var handle = parameters.GetType().GetProperty("DeviceWindowHandle")!.GetValue(parameters);
        if (handle is not IntPtr window || window == IntPtr.Zero) return;
        // RuntimeHost selects OpenGL ES. Query pixels, not the physical display
        // mode or a logical window size that may still contain a desktop preset.
        SDL_GL_GetDrawableSize(window, out var width, out var height);
        if (MatchBackBuffer(parameters, width, height))
            Console.WriteLine($"[CeleMod] Android backbuffer matched drawable: {width}x{height}");
    }

    internal static bool MatchBackBuffer(object parameters, int width, int height)
    {
        // A paused/destroyed surface may temporarily have no drawable. Keep the
        // valid requested size; SDL's next resize will reset the device again.
        if (width <= 0 || height <= 0) return false;
        var type = parameters.GetType();
        var widthProperty = type.GetProperty("BackBufferWidth")!;
        var heightProperty = type.GetProperty("BackBufferHeight")!;
        if ((int)widthProperty.GetValue(parameters)! == width &&
            (int)heightProperty.GetValue(parameters)! == height) return false;
        widthProperty.SetValue(parameters, width);
        heightProperty.SetValue(parameters, height);
        return true;
    }

    [DllImport("libSDL2.so", CallingConvention = CallingConvention.Cdecl)]
    private static extern void SDL_GL_GetDrawableSize(IntPtr window, out int width, out int height);
}
