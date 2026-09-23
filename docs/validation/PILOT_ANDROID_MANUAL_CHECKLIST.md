# SUGAT pilot Android manual release gate

Status: **MANUAL DEVICE TEST REQUIRED**. JavaScript exports and browser checks do
not verify native MapLibre, Android location services or SecureStore behavior.

Use staging only, two physical Driver phones, a Passenger phone, and three registered
test vehicles/drivers on an authorized test route. Record app build, Android version,
device model, tester, date, expected/actual result and supporting evidence for each row.
Perform Driver control interactions while safely stopped or with a separate tester.

| Driver check | Required observation | Result |
| --- | --- | --- |
| First login on phone A | Creates one authorization; Driver operations work. | NOT RUN |
| Logout, app restart, login on A | Authorization persists; same phone is accepted. | NOT RUN |
| Login on phone B before reset | Rejected with the administrator-contact message. | NOT RUN |
| Authorized route/vehicle selection | Only registered choices; no departure time or schedule. | NOT RUN |
| START | One ACTIVE trip, correct vehicle/route, VACANT, GPS begins. | NOT RUN |
| Duplicate START / route switch | Rejected or unavailable while ACTIVE. | NOT RUN |
| Background app | Passenger receives genuine location updates. | NOT RUN |
| Lock screen | GPS continues for a representative pilot journey segment. | NOT RUN |
| Network loss | Recording continues; durable queue grows within limits. | NOT RUN |
| Network recovery | Queue drains, no duplicate promotion or backward marker movement. | NOT RUN |
| FULL then VACANT | Correct Passenger vehicle changes; GPS continues; capacity unchanged. | NOT RUN |
| END | Backend confirms completion, tracking stops, marker disappears. | NOT RUN |
| Start again after END | New trip starts without Admin creating a departure. | NOT RUN |
| Admin reset during ACTIVE trip | Confirmation shown; binding/sessions revoked. | NOT RUN |
| Old phone A after reset | START, END, FULL, VACANT and GPS rejected. | NOT RUN |
| Replacement phone B | Legitimate login binds B and resumes authorized active-trip tracking. | NOT RUN |
| Restart/reboot and SecureStore | Credential remains available as intended; never displayed/logged. | NOT RUN |

| Passenger Mobile check | Required observation | Result |
| --- | --- | --- |
| Origin/destination search | Correct direction/order and permitted boarding/dropoff. | NOT RUN |
| Three matching vehicles | Real map tiles and three distinct markers before selection. | NOT RUN |
| Independent movement | Each update moves only its corresponding vehicle. | NOT RUN |
| Occupancy | Green VACANT/red FULL; Android marker bitmap updates promptly. | NOT RUN |
| Unknown occupancy | Neutral label/color; never silently VACANT. | NOT RUN |
| Freshness aging | LIVE → STALE → OFFLINE; last-known location qualified; ETA follows policy. | NOT RUN |
| Marker/card selection | Correct trip detail; registered name/plate; sticker only when present. | NOT RUN |
| Boarding notice | Exact required notice is visible and readable. | NOT RUN |
| Background/network reconnect | Subscriptions and authoritative state recover without duplicate markers. | NOT RUN |
| Socket interruption / HTTP fallback | Approximately 30-second reconciliation retains correct membership/status. | NOT RUN |
| Trip completion | Marker/list reconcile; completed trip does not reappear. | NOT RUN |

Do not mark this gate passed until observations are recorded on physical phones.
