//! Queue order core (V2-B4a): which queued task may start now, and why not.
//!
//! Pure logic over three inputs: the queued tasks in queue order (with their
//! predecessors and the seam lanes they would write), the ids of finished
//! tasks, and the seam lanes running tasks hold right now. It reuses the
//! seam lanes of [`lane_guard`] and the hold record of [`preflight`]; it reads
//! no store and starts nothing. The scheduler wiring is a later package.
//!
//! Rules, per task in queue order:
//! 1. A predecessor that is neither finished nor queued is missing; a queued
//!    one is still open; predecessors that form a cycle wait on each other.
//! 2. A seam held by a running task blocks the start.
//! 3. Two queued tasks on one seam: the earlier startable one takes it, the
//!    later one waits. Only startable tasks take a seam, so a task that waits
//!    for its predecessor cannot deadlock a predecessor on the same seam.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use crate::preflight::SeamHold;
use crate::workers::lane_guard::Seam;

/// One queued task as the queue order sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedTask {
    pub id: String,
    /// Task ids that must be finished first.
    pub depends_on: Vec<String>,
    /// Seam lanes the task would write (empty: none).
    pub seams: BTreeSet<Seam>,
}

/// Whether a queued task may start now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueueState {
    Startbar,
    /// `grund` is a German sentence for the user.
    Wartet {
        grund: String,
    },
}

/// The file a seam lane is named by in messages.
fn seam_file(seam: Seam) -> &'static str {
    match seam {
        Seam::Store => "src-tauri/src/store.rs",
        Seam::Api => "src-tauri/src/api.rs",
        Seam::Main => "src-tauri/src/main.rs",
        Seam::Cli => "src-tauri/src/bin/pa.rs",
    }
}

/// The shortest chain of queued predecessors that leads from `start` back to
/// itself, as ids (`a`, `b` for a -> b -> a), or `None`. Breadth-first, so it
/// needs no recursion and cannot overflow the stack on a long queue.
fn cycle_from<'a>(
    start: usize,
    queue: &'a [QueuedTask],
    index: &BTreeMap<&str, usize>,
) -> Option<Vec<&'a str>> {
    let mut parent: BTreeMap<usize, usize> = BTreeMap::new();
    let mut todo = VecDeque::from([start]);
    while let Some(at) = todo.pop_front() {
        for dep in queue[at]
            .depends_on
            .iter()
            .filter_map(|d| index.get(d.as_str()))
        {
            if *dep == start {
                let mut chain = vec![queue[at].id.as_str()];
                let mut node = at;
                while node != start {
                    node = parent[&node];
                    chain.push(queue[node].id.as_str());
                }
                chain.reverse();
                return Some(chain);
            }
            if *dep != at && !parent.contains_key(dep) {
                parent.insert(*dep, at);
                todo.push_back(*dep);
            }
        }
    }
    None
}

/// The cycle text for a task on a cycle, rotated to begin at the member that
/// is earliest in the queue so every member shows the same sentence.
fn cycle_reason(chain: &[&str], index: &BTreeMap<&str, usize>) -> String {
    let first = (0..chain.len())
        .min_by_key(|i| index[chain[*i]])
        .unwrap_or(0);
    let mut ring: Vec<&str> = chain[first..]
        .iter()
        .chain(&chain[..first])
        .copied()
        .collect();
    ring.push(ring[0]);
    format!("Zyklus: {}", ring.join(" → "))
}

/// The verdict for every queued task, in queue order.
pub fn queue_order(
    queue: &[QueuedTask],
    finished: &BTreeSet<String>,
    held: &[SeamHold],
) -> Vec<(String, QueueState)> {
    let mut index: BTreeMap<&str, usize> = BTreeMap::new();
    for (at, task) in queue.iter().enumerate() {
        index.entry(task.id.as_str()).or_insert(at);
    }
    // Seam -> startable queued task that took it.
    let mut taken: BTreeMap<Seam, &str> = BTreeMap::new();
    let mut out = Vec::with_capacity(queue.len());
    for (at, task) in queue.iter().enumerate() {
        let open = |dep: &&String| !finished.contains(*dep);
        let missing = task
            .depends_on
            .iter()
            .filter(open)
            .find(|d| !index.contains_key(d.as_str()));
        let reason = if let Some(chain) = cycle_from(at, queue, &index) {
            Some(cycle_reason(&chain, &index))
        } else if let Some(dep) = missing {
            Some(format!("Vorgänger {dep} fehlt in der Warteschlange"))
        } else if let Some(dep) = task.depends_on.iter().find(open) {
            Some(format!("Vorgänger {dep} ist noch offen"))
        } else {
            task.seams.iter().find_map(|seam| {
                let holder = held
                    .iter()
                    .find(|hold| hold.seam == *seam)
                    .map(|hold| hold.holder.as_str())
                    .or_else(|| taken.get(seam).copied())?;
                Some(format!("Naht {} ist belegt von {holder}", seam_file(*seam)))
            })
        };
        let state = match reason {
            Some(grund) => QueueState::Wartet { grund },
            None => {
                taken.extend(task.seams.iter().map(|seam| (*seam, task.id.as_str())));
                QueueState::Startbar
            }
        };
        out.push((task.id.clone(), state));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(id: &str, deps: &[&str], seams: &[Seam]) -> QueuedTask {
        QueuedTask {
            id: id.to_string(),
            depends_on: deps.iter().map(|d| d.to_string()).collect(),
            seams: seams.iter().copied().collect(),
        }
    }

    fn wartet(grund: &str) -> QueueState {
        QueueState::Wartet {
            grund: grund.to_string(),
        }
    }

    fn run(queue: &[QueuedTask], finished: &[&str], held: &[(Seam, &str)]) -> Vec<QueueState> {
        let finished = finished.iter().map(|f| f.to_string()).collect();
        let held: Vec<SeamHold> = held
            .iter()
            .map(|(seam, holder)| SeamHold {
                seam: *seam,
                holder: holder.to_string(),
            })
            .collect();
        let out = queue_order(queue, &finished, &held);
        let ids: Vec<&str> = out.iter().map(|(id, _)| id.as_str()).collect();
        let want: Vec<&str> = queue.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, want, "one verdict per task, in queue order");
        out.into_iter().map(|(_, state)| state).collect()
    }

    #[test]
    fn task_without_constraints_is_startbar() {
        assert_eq!(
            run(&[task("a", &[], &[])], &[], &[]),
            [QueueState::Startbar]
        );
    }

    #[test]
    fn open_predecessor_makes_the_task_wait_with_its_id() {
        let queue = [task("a", &[], &[]), task("b", &["a"], &[])];
        assert_eq!(
            run(&queue, &[], &[]),
            [QueueState::Startbar, wartet("Vorgänger a ist noch offen")]
        );
    }

    #[test]
    fn finished_predecessor_is_startbar() {
        let queue = [task("b", &["a"], &[])];
        assert_eq!(run(&queue, &["a"], &[]), [QueueState::Startbar]);
    }

    #[test]
    fn missing_predecessor_is_named() {
        let queue = [task("b", &["ghost"], &[])];
        assert_eq!(
            run(&queue, &[], &[]),
            [wartet("Vorgänger ghost fehlt in der Warteschlange")]
        );
    }

    #[test]
    fn held_seam_names_file_and_holder() {
        let queue = [task("a", &[], &[Seam::Api])];
        assert_eq!(
            run(&queue, &[], &[(Seam::Api, "runner")]),
            [wartet("Naht src-tauri/src/api.rs ist belegt von runner")]
        );
        // A different seam is not in the way.
        assert_eq!(
            run(&queue, &[], &[(Seam::Main, "runner")]),
            [QueueState::Startbar]
        );
    }

    #[test]
    fn two_queued_tasks_on_one_seam_only_the_first_is_startbar() {
        let queue = [
            task("a", &[], &[Seam::Store]),
            task("b", &[], &[Seam::Store, Seam::Cli]),
            task("c", &[], &[Seam::Cli]),
        ];
        assert_eq!(
            run(&queue, &[], &[]),
            [
                QueueState::Startbar,
                wartet("Naht src-tauri/src/store.rs ist belegt von a"),
                // b is not startable, so it does not take the cli seam.
                QueueState::Startbar,
            ]
        );
    }

    #[test]
    fn a_waiting_task_does_not_take_the_seam_of_its_own_predecessor() {
        // a (first in queue) needs b; both write the api seam. b must go
        // first, otherwise the queue would deadlock.
        let queue = [
            task("a", &["b"], &[Seam::Api]),
            task("b", &[], &[Seam::Api]),
        ];
        assert_eq!(
            run(&queue, &[], &[]),
            [wartet("Vorgänger b ist noch offen"), QueueState::Startbar]
        );
    }

    #[test]
    fn dependency_cycle_waits_with_the_cycle_and_never_panics() {
        let queue = [
            task("a", &["b"], &[]),
            task("b", &["a"], &[]),
            task("c", &["b"], &[]),
        ];
        let cycle = wartet("Zyklus: a → b → a");
        assert_eq!(
            run(&queue, &[], &[]),
            [cycle.clone(), cycle, wartet("Vorgänger b ist noch offen")]
        );
        assert_eq!(
            run(&[task("s", &["s"], &[])], &[], &[]),
            [wartet("Zyklus: s → s")]
        );
    }
}
