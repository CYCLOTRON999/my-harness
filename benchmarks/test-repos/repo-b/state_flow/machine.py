class StateMachineError(Exception):
    pass

class StateMachine:
    def __init__(self, initial_state="idle"):
        self.current_state = initial_state
        self.transitions = {}

    def add_transition(self, event, from_state, to_state):
        if event not in self.transitions:
            self.transitions[event] = {}
        self.transitions[event][from_state] = to_state

    def trigger(self, event, payload=None):
        if event not in self.transitions or self.current_state not in self.transitions[event]:
            raise StateMachineError(f"Cannot transition on event '{event}' from state '{self.current_state}'")

        next_state = self.transitions[event][self.current_state]
        self.current_state = next_state
        return self.current_state
