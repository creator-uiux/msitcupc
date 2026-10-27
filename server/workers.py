"""Background workers  --  the always-on part of the system.

A single daemon thread ticks the world clock (schedule checks, confirmation
reminders, dependency follow-ups, rescheduled visits) on a fixed interval and
publishes change notifications to the SSE hub so connected browsers refresh.
"""
import threading

import engine


class Worker(threading.Thread):
    def __init__(self, state, hub, interval=9.0):
        super().__init__(daemon=True, name="itc-worker")
        self.state = state
        self.hub = hub
        self.interval = float(interval)
        self._stop = threading.Event()

    def run(self):
        while not self._stop.wait(self.interval):
            try:
                self.tick()
            except Exception as exc:  # never kill the worker
                self.hub.publish({"type": "error", "message": str(exc)})

    def tick(self):
        with self.state.lock:
            before = self.state.data.get("rev")
            events = engine.world_tick(self.state.data)
            if self.state.data.get("rev") != before:
                self.state.save()
        if events:
            self.hub.publish({"type": "tick", "events": events, "rev": self.state.data.get("rev")})
        return events

    def stop(self):
        self._stop.set()
