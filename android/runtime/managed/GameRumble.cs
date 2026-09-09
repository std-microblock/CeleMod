using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Loader;

// Mirror the final FNA motor output, not input gestures or guessed game events.
// FNA may return false without a physical pad; the phone still receives the output.
internal static class GameRumble
{
    internal const int Command = 0xCE01; // SDL user command; paired with GameVibration.COMMAND.
    private static RumbleOutput? output;

    internal static void Install()
    {
        if (Environment.GetEnvironmentVariable("CELEMOD_GAME_RUMBLE") != "1") return;
        try {
            var fna = Assembly.Load("FNA");
            var player = fna.GetType("Microsoft.Xna.Framework.PlayerIndex", true)!;
            var vibration = fna.GetType("Microsoft.Xna.Framework.Input.GamePad", true)!
                .GetMethod("SetVibration", new[] { player, typeof(float), typeof(float) })
                ?? throw new MissingMethodException("GamePad.SetVibration");
            var file = Path.Combine(AppContext.BaseDirectory, "Celeste.dll");
            if (!File.Exists(file)) file = Path.Combine(AppContext.BaseDirectory, "Celeste.exe");
            var engine = AssemblyLoadContext.Default.LoadFromAssemblyPath(file).GetType("Monocle.Engine", true)!;
            var update = engine.GetMethods(BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance |
                BindingFlags.DeclaredOnly).Single(m => m.Name == "Update" && m.GetParameters().Length == 1);
            GameHooks.Add(vibration, nameof(SetVibration), typeof(GameRumble), player);
            GameHooks.Add(update, nameof(Update), typeof(GameRumble), engine, update.GetParameters()[0].ParameterType);
            output = new RumbleOutput(amplitude => {
                if (SDL_AndroidSendMessage(Command, amplitude) < 0)
                    throw new InvalidOperationException("SDL rejected the Android rumble message");
            });
            Console.WriteLine("[CeleMod] Game controller rumble connected to Android vibration.");
        } catch (Exception e) {
            Console.WriteLine("[CeleMod] Game vibration unavailable: " + e);
        }
    }

    private static bool SetVibration<TPlayer>(Func<TPlayer, float, float, bool> original,
        TPlayer player, float left, float right)
    {
        var result = original(player, left, right); // Preserve physical controllers and return semantics.
        output?.Set(Convert.ToInt32(player), left, right, Environment.TickCount64);
        return result;
    }

    private static void Update<TGame, TTime>(Action<TGame, TTime> original, TGame game, TTime time)
    {
        original(game, time);
        output?.Pump(Environment.TickCount64);
    }

    [DllImport("libSDL2.so", CallingConvention = CallingConvention.Cdecl)]
    private static extern int SDL_AndroidSendMessage(int command, int parameter);
}

// Four logical pads share one phone motor. Zeros from an idle pad must not cancel
// another pad's rumble. Renew a short lease only while the game is updating, so a
// stalled/exited game cannot leave the phone vibrating indefinitely.
internal sealed class RumbleOutput(Action<int> send)
{
    private readonly object sync = new();
    private readonly int[] motors = new int[4];
    private int last;
    private long nextRefresh;
    private bool failed;

    internal static int Amplitude(float left, float right)
    {
        static float Safe(float value) => float.IsFinite(value) ? Math.Clamp(value, 0f, 1f) : 0f;
        var strength = Math.Max(Safe(left), Safe(right));
        return strength <= 0 ? 0 : Math.Max(1, (int)Math.Round(strength * 255));
    }

    internal void Set(int player, float left, float right, long now)
    {
        if ((uint)player >= motors.Length) return;
        lock (sync) {
            motors[player] = Amplitude(left, right);
            Publish(now);
        }
    }

    internal void Pump(long now) { lock (sync) Publish(now); }

    private void Publish(long now)
    {
        if (failed) return;
        int amplitude = motors.Max();
        if (amplitude == last && (amplitude == 0 || now < nextRefresh)) return;
        try {
            send(amplitude);
            last = amplitude;
            nextRefresh = now + 100;
        } catch (Exception e) {
            failed = true; // Haptics must never interrupt the game, or spam failures every frame.
            Console.WriteLine("[CeleMod] Android vibration bridge disabled: " + e.Message);
        }
    }
}
