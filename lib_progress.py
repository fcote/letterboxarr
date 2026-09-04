"""Where a running sync round has got to

Its own module because both halves of a round report into it: the orchestrator
in lib_sync runs the Radarr phase and the refresher in lib_refresh runs the
other three, and lib_sync already imports lib_refresh — so the record they
share cannot live in either without pointing an import back the way it came.
"""

import time
from threading import Lock
from typing import Dict, Optional

# The phases of a round, in the order they run, with what the dashboard calls
# them. A round that is not refreshing runs only the Radarr phase, which is why
# the step number is counted over the phases a round will actually run rather
# than over this whole list.
PHASE_LISTS = 'lists'
PHASE_RADARR = 'radarr'
PHASE_RELEASES = 'releases'
PHASE_RATINGS = 'ratings'

PHASE_LABELS = {
    PHASE_LISTS: 'Reading your lists',
    PHASE_RADARR: 'Handing films to Radarr',
    PHASE_RELEASES: 'Reading release dates',
    PHASE_RATINGS: 'Reading ratings',
}


class SyncProgress:
    """Where the running round has got to, for the dashboard to watch

    Kept in memory rather than in sync_runs. A round's position is worth
    nothing once the round is over, and the Radarr phase would otherwise write
    a row per film to record something nobody will ever read again: the
    database holds what has been read from Letterboxd and handed to Radarr,
    which is the application's data, and how far along a round is is not that.
    It dies with the process, which is what happens to the round it describes
    as well.

    Every change bumps `version`, and that integer is the whole of the long
    poll: a reader says which version it has already seen and is answered the
    moment there is a newer one, rather than on a timer that is either too slow
    to follow a round or too fast to be worth the requests.

    Written from the sync thread and read from the request handlers, so every
    field moves under the one lock and readers take a snapshot rather than
    reading fields one at a time — a half-updated read would show a count from
    one phase against the name of another.
    """

    def __init__(self):
        self.lock = Lock()
        self.version = 0
        self.running = False
        self.phase: Optional[str] = None
        self.step = 0
        self.steps = 0
        self.done = 0
        self.total = 0
        self.item: Optional[str] = None
        self.added = 0
        self.started_at: Optional[float] = None

    def start(self, steps: int) -> None:
        """A round has begun and will run `steps` phases"""
        with self.lock:
            self.running = True
            self.phase = None
            self.step = 0
            self.steps = steps
            self.done = self.total = self.added = 0
            self.item = None
            self.started_at = time.time()
            self.version += 1

    def begin(self, phase: str, total: int) -> None:
        """A phase has begun, with `total` things to get through"""
        with self.lock:
            self.phase = phase
            self.step += 1
            self.done = 0
            self.total = total
            self.item = None
            self.version += 1

    def step_item(self, item: Optional[str], done: int) -> None:
        """Starting on `item`, with `done` of the phase already behind it

        Counted this way round so a reader sees the number finished against the
        name of the one being worked on now, which is what "214 of 500, The
        Odyssey" is asking to mean.
        """
        with self.lock:
            self.done = done
            self.item = item
            self.version += 1

    def finish_phase(self) -> None:
        """The phase is through, so its bar reads full rather than one short"""
        with self.lock:
            self.done = self.total
            self.item = None
            self.version += 1

    def add(self, added: int = 1) -> None:
        """A movie reached Radarr"""
        with self.lock:
            self.added += added
            self.version += 1

    def finish(self) -> None:
        """The round is over, however it ended"""
        with self.lock:
            self.running = False
            self.phase = None
            self.item = None
            self.version += 1

    def snapshot(self) -> Dict:
        """Everything about the round at one instant"""
        with self.lock:
            return {
                'version': self.version,
                'running': self.running,
                'phase': self.phase,
                'label': PHASE_LABELS.get(self.phase) if self.phase else None,
                'step': self.step,
                'steps': self.steps,
                'done': self.done,
                'total': self.total,
                'item': self.item,
                'added': self.added,
                'started_at': self.started_at,
            }
