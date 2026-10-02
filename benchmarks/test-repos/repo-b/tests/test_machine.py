import unittest
from state_flow.machine import StateMachine, StateMachineError

class TestStateMachine(unittest.TestCase):
    def test_initial_state(self):
        sm = StateMachine("stopped")
        self.assertEqual(sm.current_state, "stopped")

    def test_valid_transition(self):
        sm = StateMachine("idle")
        sm.add_transition("start", "idle", "running")
        res = sm.trigger("start")
        self.assertEqual(res, "running")
        self.assertEqual(sm.current_state, "running")

    def test_invalid_transition(self):
        sm = StateMachine("idle")
        with self.assertRaises(StateMachineError):
            sm.trigger("unknown_event")

if __name__ == "__main__":
    unittest.main()
