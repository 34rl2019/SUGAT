export async function reconcileTrackingLifecycle(assignment, dependencies) {
  const [localTripId, running] = await Promise.all([
    dependencies.localTripId(),
    dependencies.trackingRunning(),
  ]);
  const activeTripId = assignment?.status === 'ACTIVE' ? assignment.id : null;

  if (!activeTripId) {
    try {
      if (running || localTripId) await dependencies.stop();
    } finally {
      if (localTripId) await dependencies.clearQueue(localTripId);
    }
    return { activeTripId: null, running: false, reconciled: Boolean(running || localTripId) };
  }

  if (localTripId && localTripId !== activeTripId) {
    try {
      if (running) await dependencies.stop();
    } finally {
      await dependencies.clearQueue(localTripId);
    }
    await dependencies.start(activeTripId);
    return { activeTripId, running: true, reconciled: true };
  }

  if (!running || localTripId !== activeTripId) {
    await dependencies.start(activeTripId);
    return { activeTripId, running: true, reconciled: true };
  }

  return { activeTripId, running: true, reconciled: false };
}

export async function completeTrackingLifecycle(tripId, dependencies) {
  // A failed queued upload must not prevent the server from ending the trip.
  try { await dependencies.sync(tripId); } catch {}
  const completed = await dependencies.complete(tripId);
  try {
    await dependencies.stop();
  } finally {
    await dependencies.clearQueue(tripId);
  }
  return completed;
}
