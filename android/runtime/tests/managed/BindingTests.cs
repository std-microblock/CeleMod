// Exercise the snapshot producer as well as Android's consumer: missing metadata,
// empty bindings and live reinitialization must not collapse to vanilla defaults.
static class BindingTests
{
    public static void Run()
    {
        int count = 0;
        void Check(bool condition, string message) {
            if (!condition) throw new Exception(message);
            count++;
        }
        var input = new TestInput();
        var settings = new TestSettings();
        var first = GameControls.Bindings(input, settings);
        Check(first["Jump"].SequenceEqual(new[] { "Space" }), "read the live Jump binding");
        Check(first["MenuConfirm"].SequenceEqual(new[] { "V" }), "menu confirm is independent of jump");
        Check(first["Pause"].SequenceEqual(new[] { "P" }), "publish rebound pause");
        Check(first["Grab"].Length == 0, "controller-only binding stays explicitly empty");
        Check(!first.ContainsKey("Dash"), "missing input metadata stays absent");
        Check(first["Left"].Length == 0 && first["LeftMoveOnly"].Single() == "A" &&
            first["LeftDashOnly"].Single() == "J", "publish split movement/aim bindings");
        Check(first["MenuUp"].Single() == "W", "menu directions use live input, not gameplay settings");
        input.Jump = new(new[] { "K", "L" }); // Input.Initialize replaces VirtualButtons.
        input.MenuConfirm.Binding.Keyboard.Clear();
        var second = GameControls.Bindings(input, settings);
        Check(second["Jump"].SequenceEqual(new[] { "K", "L" }), "resample replaced buttons");
        Check(second["MenuConfirm"].Length == 0, "resample cleared binding without fallback");
        Check(first["Jump"].Single() == "Space" && first["MenuConfirm"].Single() == "V",
            "previous snapshot remains immutable");
        Check(GameControls.Bindings(null, null).Count == 0, "unavailable hook leaves fallback metadata absent");
        Console.WriteLine($"PASS: {count} managed binding cases.");
    }

    private sealed class TestBinding {
        public List<string> Keyboard;
        public TestBinding(params string[] keys) => Keyboard = keys.ToList();
    }
    private sealed class TestButton {
        public TestBinding Binding;
        public TestButton(params string[] keys) => Binding = new(keys);
    }
    private sealed class TestInput {
        public TestButton Jump = new("Space"), MenuConfirm = new("None", "V"),
            Grab = new(), Pause = new("P"), MenuUp = new("W");
    }
    private sealed class TestSettings {
        public TestBinding Left = new(), LeftMoveOnly = new("A"), LeftDashOnly = new("J");
    }
}
