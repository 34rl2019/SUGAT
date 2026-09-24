import NetInfo from '@react-native-community/netinfo';
import { mobileColors as colors } from '@sugat/theme';
import { StatusBar } from 'expo-status-bar';
import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';

import {
  ApiError,
  changePassword,
  login,
  logout as revokeSession,
} from './src/api/client';

import {
  Assignment,
  Operations,
  completeTrip,
  getOperations,
  setOccupancy,
  startTrip,
} from './src/api/trips';

import {
  clearSession,
  getAccessToken,
  mustChangePassword,
} from './src/auth/session';

import {
  requestAndroidNotificationPermission,
} from './src/location/android-permissions';

import {
  clearCompletedTripQueue,
  permissionRecoveryMessage,
  reconcileAuthoritativeTracking,
  requestTrackingPermissions,
  startTracking,
  stopTracking,
  syncQueue,
  trackingStatus,
  TrackingPermissionState,
} from './src/location/tracker';

import {
  completeTrackingLifecycle,
} from './src/location/tracking-lifecycle';

type GpsState = {
  running: boolean;
  queued: number;
  maxQueued: number;
  lastUpload: string | null;
  permissionState: TrackingPermissionState;
};

export default function App() {
  const [booting, setBooting] = useState(true);

  const [
    authenticated,
    setAuthenticated,
  ] = useState(false);

  const [
    assignment,
    setAssignment,
  ] = useState<Assignment | null>(null);

  const [
    operations,
    setOperations,
  ] = useState<Operations | null>(null);

  const [
    selectedStartStopId,
    setSelectedStartStopId,
  ] = useState('');

  const [
    selectedDestinationStopId,
    setSelectedDestinationStopId,
  ] = useState('');

  const [
    selectedRouteId,
    setSelectedRouteId,
  ] = useState('');

  const [
    startSearch,
    setStartSearch,
  ] = useState('');

  const [
    destinationSearch,
    setDestinationSearch,
  ] = useState('');

  const [
    startSearchFocused,
    setStartSearchFocused,
  ] = useState(false);

  const [
    destinationSearchFocused,
    setDestinationSearchFocused,
  ] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [
    passwordChangeRequired,
    setPasswordChangeRequired,
  ] = useState(false);

  const [
    newPassword,
    setNewPassword,
  ] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(true);

  const [
    permissionNotice,
    setPermissionNotice,
  ] = useState('');

  const [gps, setGps] = useState<GpsState>({
    running: false,
    queued: 0,
    maxQueued: 5000,
    lastUpload: null,
    permissionState: 'UNKNOWN',
  });

  const refreshGps = useCallback(
    async () => {
      try {
        const status = await trackingStatus();

        setGps(status);

        setPermissionNotice(
          permissionRecoveryMessage(
            status.permissionState,
          ) ?? '',
        );
      } catch {
        // GPS status is informational only.
      }
    },
    [],
  );

  /*
   * Load the authoritative driver state.
   *
   * The driver does not select a route or vehicle.
   * The backend resolves:
   *
   * driver -> assigned vehicle -> default route
   */
  const loadAssignment = useCallback(
    async () => {
      const currentOperations =
        await getOperations();

      setOperations(currentOperations);

      const current =
        currentOperations.activeTrip ?? null;

      setAssignment(current);

      await reconcileAuthoritativeTracking(
        current,
      );

      if (current?.status === 'ACTIVE') {
        try {
          await syncQueue(current.id);
        } catch {
          // Queue retries automatically.
        }
      }

      await refreshGps();

      return current;
    },
    [refreshGps],
  );

  /*
   * Restore authenticated session.
   */
  useEffect(() => {
    void (async () => {
      try {
        const token = await getAccessToken();

        if (token) {
          setAuthenticated(true);

          const required =
            await mustChangePassword();

          setPasswordChangeRequired(
            required,
          );

          if (!required) {
            await loadAssignment();
          }
        }
      } catch (caught) {
        if (
          caught instanceof ApiError &&
          caught.status === 401
        ) {
          await clearSession();
          setAuthenticated(false);
        } else {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Unable to restore session.',
          );
        }
      } finally {
        setBooting(false);
      }
    })();
  }, [loadAssignment]);

  /*
   * Network monitoring.
   */
  useEffect(() => {
    const unsubscribe =
      NetInfo.addEventListener(state => {
        const connected = Boolean(
          state.isConnected &&
            state.isInternetReachable !== false,
        );

        setOnline(connected);

        if (
          connected &&
          assignment?.status === 'ACTIVE'
        ) {
          void syncQueue(assignment.id)
            .then(refreshGps)
            .catch(() => {});
        }
      });

    return unsubscribe;
  }, [
    assignment?.id,
    assignment?.status,
    refreshGps,
  ]);

  /*
   * Periodic GPS status and foreground
   * reconciliation.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      void refreshGps();
    }, 3000);

    const subscription =
      AppState.addEventListener(
        'change',
        state => {
          if (
            state === 'active' &&
            authenticated &&
            !passwordChangeRequired
          ) {
            void loadAssignment().catch(
              () => {},
            );
          }
        },
      );

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [
    authenticated,
    passwordChangeRequired,
    loadAssignment,
    refreshGps,
  ]);

  /*
   * LOGIN
   */
  async function submitLogin() {
    if (!email.trim() || !password) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      const session = await login(
        email.trim(),
        password,
      );

      setAuthenticated(true);

      const requiresPasswordChange =
        Boolean(
          session.mustChangePassword,
        );

      setPasswordChangeRequired(
        requiresPasswordChange,
      );

      if (!requiresPasswordChange) {
        await loadAssignment();
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Login failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * FIRST LOGIN PASSWORD CHANGE
   */
  async function submitPasswordChange() {
    if (!newPassword) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      await changePassword(
        password,
        newPassword,
      );

      setPasswordChangeRequired(false);
      setPassword('');
      setNewPassword('');

      await loadAssignment();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Password could not be changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * DRIVER ROUTE SELECTION
   *
   * FROM and TO are canonical database stops returned by
   * /driver/operations. Free-text values are never sent to
   * the backend.
   */
  const registeredVehicle =
    operations?.vehicles.length === 1
      ? operations.vehicles[0]
      : null;

  /*
   * FROM / TO selectors use the canonical stop directory
   * returned by /driver/operations.
   *
   * Route coverage must not limit which canonical locations
   * the driver can search or select. Route resolution happens
   * only after both FROM and TO have been selected.
   *
   * STAGING TEST ONLY records are excluded from the driver UI.
   */
  const canonicalStops =
    operations?.stops.filter(
      stop =>
        stop.cityMunicipality !==
          'STAGING TEST ONLY' &&
        stop.province !== 'STAGING TEST ONLY',
    ) ?? [];

  const validStartStops = canonicalStops;

  const validDestinationStops =
    selectedStartStopId
      ? canonicalStops.filter(
          stop =>
            stop.id !== selectedStartStopId,
        )
      : [];

  const matchingRoutes =
    selectedStartStopId &&
    selectedDestinationStopId &&
    operations
      ? [...operations.routes]
          .filter(route => {
            const start = route.stops.find(
              routeStop =>
                routeStop.stopId ===
                selectedStartStopId,
            );

            const destination =
              route.stops.find(
                routeStop =>
                  routeStop.stopId ===
                  selectedDestinationStopId,
            );

            return Boolean(
              start &&
                destination &&
                start.boardingAllowed &&
                destination.dropoffAllowed &&
                start.sequence <
                  destination.sequence,
            );
          })
          .sort(
            (a, b) =>
              a.name.localeCompare(b.name) ||
              a.id.localeCompare(b.id),
          )
      : [];

  const selectedRoute =
    matchingRoutes.length === 1
      ? matchingRoutes[0]
      : matchingRoutes.find(
          route => route.id === selectedRouteId,
        ) ?? null;

  const routeViaStops = (route: Operations['routes'][number]) => {
    const start = route.stops.find(
      routeStop =>
        routeStop.stopId === selectedStartStopId,
    );

    const destination = route.stops.find(
      routeStop =>
        routeStop.stopId ===
        selectedDestinationStopId,
    );

    if (
      !start ||
      !destination ||
      start.sequence >= destination.sequence
    ) {
      return [];
    }

    return route.stops
      .filter(
        routeStop =>
          routeStop.sequence > start.sequence &&
          routeStop.sequence < destination.sequence,
      )
      .sort(
        (a, b) => a.sequence - b.sequence,
      )
      .map(routeStop =>
        canonicalStops.find(
          stop => stop.id === routeStop.stopId,
        ),
      )
      .filter(
        (
          stop,
        ): stop is (typeof canonicalStops)[number] =>
          Boolean(stop),
      );
  };

  const normalizedStartSearch =
    startSearch.trim().toLowerCase();

  const normalizedDestinationSearch =
    destinationSearch.trim().toLowerCase();

  const startSuggestions =
    validStartStops
      .filter(stop =>
        !normalizedStartSearch
          ? true
          : `${stop.name} ${stop.cityMunicipality ?? ''} ${stop.province ?? ''}`
              .toLowerCase()
              .includes(normalizedStartSearch),
      )
      .slice(0, 8);

  const destinationSuggestions =
    validDestinationStops
      .filter(stop =>
        !normalizedDestinationSearch
          ? true
          : `${stop.name} ${stop.cityMunicipality ?? ''} ${stop.province ?? ''}`
              .toLowerCase()
              .includes(
                normalizedDestinationSearch,
              ),
      )
      .slice(0, 8);

  /*
   * START TRIP
   *
   * The driver selects canonical FROM and TO stops.
   * The app resolves a valid active route containing that
   * ordered segment and submits database IDs to the API.
   */
  async function begin() {
    if (
      assignment ||
      !operations ||
      !operations.compliance.eligible ||
      !registeredVehicle ||
      !selectedStartStopId ||
      !selectedDestinationStopId ||
      !selectedRoute
    ) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      const notification =
        await requestAndroidNotificationPermission();

      if (!notification.granted) {
        setError(notification.reason);
        return;
      }

      const permission =
        await requestTrackingPermissions();

      if (!permission.granted) {
        setError(permission.reason);
        return;
      }

      const trip = await startTrip({
        routeId: selectedRoute.id,
        vehicleId: registeredVehicle.id,
        startStopId: selectedStartStopId,
        destinationStopId:
          selectedDestinationStopId,
      });

      await startTracking(trip.id);

      await loadAssignment();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Trip could not start.',
      );

      try {
        await loadAssignment();
      } catch {
        // Server reconciliation will retry.
      }
    } finally {
      setBusy(false);
    }
  }

  /*
   * FULL / VACANT
   */
  async function occupancy(
    value: 'VACANT' | 'FULL',
  ) {
    if (!assignment) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      const updated = await setOccupancy(
        assignment.id,
        value,
      );

      setAssignment(current =>
        current
          ? {
              ...current,
              occupancyStatus:
                updated.occupancyStatus,
            }
          : current,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Occupancy update failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * END TRIP CONFIRMATION
   */
  function confirmComplete() {
    if (!assignment) {
      return;
    }

    Alert.alert(
      'END THIS TRIP?',
      'The vehicle will stop appearing as an active trip to passengers.',
      [
        {
          text: 'CANCEL',
          style: 'cancel',
        },
        {
          text: 'END TRIP',
          style: 'destructive',
          onPress: () => void finish(),
        },
      ],
    );
  }

  /*
   * END TRIP
   */
  async function finish() {
    if (!assignment) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      await completeTrackingLifecycle(
        assignment.id,
        {
          sync: syncQueue,
          complete: completeTrip,
          stop: stopTracking,
          clearQueue:
            clearCompletedTripQueue,
        },
      );

      setAssignment(null);
      setSelectedStartStopId('');
      setSelectedDestinationStopId('');
      setSelectedRouteId('');
      setStartSearch('');
      setDestinationSearch('');
      setStartSearchFocused(false);
      setDestinationSearchFocused(false);

      await loadAssignment();
    } catch (caught) {
      setError(
        `${
          caught instanceof Error
            ? caught.message
            : 'Completion failed.'
        } The app will reconcile tracking with the server automatically.`,
      );

      try {
        await loadAssignment();
      } catch {
        // Reconciliation will retry.
      }
    } finally {
      setBusy(false);
    }
  }

  /*
   * LOGOUT
   */
  function logout() {
    if (
      assignment?.status === 'ACTIVE'
    ) {
      setError(
        'Please END TRIP before logging out.',
      );
      return;
    }

    Alert.alert(
      'LOG OUT?',
      'Your SUGAT driver session will be ended.',
      [
        {
          text: 'CANCEL',
          style: 'cancel',
        },
        {
          text: 'LOG OUT',
          onPress: () =>
            void (async () => {
              try {
                await stopTracking();
              } catch {
                // Continue logout.
              }

              await revokeSession();

              setAuthenticated(false);
              setAssignment(null);
              setOperations(null);
              setEmail('');
              setPassword('');
              setNewPassword('');
              setError('');
            })(),
        },
      ],
    );
  }

  /*
   * BOOT SCREEN
   */
  if (booting) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe}>
          <StatusBar style="light" />

          <View style={styles.center}>
            <Text style={styles.logo}>
              SUGAT
            </Text>

            <ActivityIndicator
              size="large"
              color={colors.gold}
            />

            <Text style={styles.muted}>
              Loading driver app…
            </Text>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  /*
   * LOGIN SCREEN
   */
  if (!authenticated) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe}>
          <StatusBar style="light" />

          <KeyboardAvoidingView
            style={styles.flex}
            behavior={
              Platform.OS === 'ios'
                ? 'padding'
                : undefined
            }
          >
            <ScrollView
              contentContainerStyle={
                styles.loginContainer
              }
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.loginHeader}>
                <Text style={styles.logo}>
                  SUGAT
                </Text>

                <Text style={styles.loginTitle}>
                  DRIVER
                </Text>

                <Text
                  style={styles.loginSubtitle}
                >
                  Scan. Track. Ride.
                </Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.label}>
                  DRIVER LOGIN
                </Text>

                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email"
                  placeholderTextColor="#9BAFC1"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  editable={!busy}
                  style={styles.input}
                />

                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  placeholderTextColor="#9BAFC1"
                  secureTextEntry
                  autoCapitalize="none"
                  editable={!busy}
                  style={styles.input}
                />

                {error ? (
                  <ErrorBox message={error} />
                ) : null}

                <Action
                  label={
                    busy
                      ? 'PLEASE WAIT…'
                      : 'LOGIN'
                  }
                  disabled={
                    busy ||
                    !email.trim() ||
                    !password
                  }
                  onPress={() =>
                    void submitLogin()
                  }
                />
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  /*
   * PASSWORD CHANGE SCREEN
   */
  if (passwordChangeRequired) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe}>
          <StatusBar style="light" />

          <KeyboardAvoidingView
            style={styles.flex}
            behavior={
              Platform.OS === 'ios'
                ? 'padding'
                : undefined
            }
          >
            <ScrollView
              contentContainerStyle={
                styles.loginContainer
              }
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.loginHeader}>
                <Text style={styles.logo}>
                  SUGAT
                </Text>

                <Text style={styles.loginTitle}>
                  CHANGE PASSWORD
                </Text>

                <Text
                  style={styles.loginSubtitle}
                >
                  Please create a new driver
                  password.
                </Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.label}>
                  NEW PASSWORD
                </Text>

                <TextInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="New password"
                  placeholderTextColor="#9BAFC1"
                  secureTextEntry
                  autoCapitalize="none"
                  editable={!busy}
                  style={styles.input}
                />

                {error ? (
                  <ErrorBox message={error} />
                ) : null}

                <Action
                  label={
                    busy
                      ? 'PLEASE WAIT…'
                      : 'SAVE PASSWORD'
                  }
                  disabled={
                    busy ||
                    newPassword.length < 12
                  }
                  onPress={() =>
                    void submitPasswordChange()
                  }
                />
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  /*
   * MAIN DRIVER SCREEN
   */
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />

        <ScrollView
          contentContainerStyle={
            styles.container
          }
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.logo}>
                SUGAT
              </Text>

              <Text
                style={styles.headerSubtitle}
              >
                DRIVER APP
              </Text>
            </View>

            <Pressable
              onPress={logout}
              disabled={busy}
              style={styles.logoutButton}
            >
              <Text style={styles.logoutText}>
                LOG OUT
              </Text>
            </Pressable>
          </View>

          <View
            style={[
              styles.statusBar,
              online
                ? styles.statusOnline
                : styles.statusOffline,
            ]}
          >
            <View
              style={[
                styles.statusDot,
                online
                  ? styles.dotOnline
                  : styles.dotOffline,
              ]}
            />

            <Text style={styles.statusText}>
              {online
                ? 'INTERNET ONLINE'
                : 'INTERNET OFFLINE'}
            </Text>
          </View>

          {error ? (
            <ErrorBox message={error} />
          ) : null}

          {assignment ? (
            /*
             * ACTIVE TRIP
             */
            <View>
              <View style={styles.activeHeader}>
                <Text
                  style={styles.activeTitle}
                >
                  TRIP ACTIVE
                </Text>

                <Text
                  style={styles.activeSubtitle}
                >
                  Your vehicle is visible to
                  passengers.
                </Text>
              </View>

              <View
                style={styles.occupancyCard}
              >
                <Text style={styles.label}>
                  CURRENT STATUS
                </Text>

                <Text
                  style={[
                    styles.occupancyValue,
                    assignment.occupancyStatus ===
                    'FULL'
                      ? styles.fullText
                      : styles.vacantText,
                  ]}
                >
                  {assignment.occupancyStatus ??
                    'VACANT'}
                </Text>
              </View>

              <View style={styles.buttonRow}>
                <View
                  style={styles.buttonHalf}
                >
                  <Action
                    label="FULL"
                    danger
                    disabled={
                      busy || !online
                    }
                    onPress={() =>
                      void occupancy('FULL')
                    }
                  />
                </View>

                <View
                  style={styles.buttonHalf}
                >
                  <Action
                    label="VACANT"
                    disabled={
                      busy || !online
                    }
                    onPress={() =>
                      void occupancy('VACANT')
                    }
                  />
                </View>
              </View>

              <View style={styles.gpsCard}>
                <View
                  style={styles.gpsHeader}
                >
                  <Text style={styles.label}>
                    GPS TRACKING
                  </Text>

                  <View
                    style={styles.gpsStatus}
                  >
                    <View
                      style={[
                        styles.statusDot,
                        gps.running
                          ? styles.dotOnline
                          : styles.dotOffline,
                      ]}
                    />

                    <Text
                      style={
                        styles.gpsStatusText
                      }
                    >
                      {gps.running
                        ? 'ACTIVE'
                        : 'INACTIVE'}
                    </Text>
                  </View>
                </View>

                {gps.queued > 0 ? (
                  <Text style={styles.muted}>
                    {gps.queued} GPS point
                    {gps.queued === 1
                      ? ''
                      : 's'}{' '}
                    waiting to sync.
                  </Text>
                ) : (
                  <Text style={styles.muted}>
                    GPS data is synchronized.
                  </Text>
                )}

                {permissionNotice ? (
                  <Text
                    style={styles.warning}
                  >
                    {permissionNotice}
                  </Text>
                ) : null}
              </View>

              <Action
                label={
                  busy
                    ? 'PLEASE WAIT…'
                    : 'END TRIP'
                }
                danger
                disabled={
                  busy || !online
                }
                onPress={confirmComplete}
              />
            </View>
          ) : (
            /*
             * READY / START TRIP
             */
            <View>
              <View style={styles.startHeader}>
                <Text
                  style={styles.startTitle}
                >
                  READY TO DRIVE
                </Text>

                <Text
                  style={styles.startSubtitle}
                >
                  Select your route and press
                  START TRIP when you are ready
                  to depart.
                </Text>
              </View>

              {registeredVehicle ? (
                <View style={styles.infoCard}>
                  <Text style={styles.label}>
                    REGISTERED VEHICLE
                  </Text>

                  <Text
                    style={styles.vehicleName}
                  >
                    {registeredVehicle.displayName}
                  </Text>

                  <Text style={styles.plate}>
                    {registeredVehicle.plateNumber}
                  </Text>

                  {registeredVehicle.bodyNumber ? (
                    <Text style={styles.muted}>
                      Body No.{' '}
                      {registeredVehicle.bodyNumber}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <View style={styles.complianceBox}>
                  <Text
                    style={styles.complianceTitle}
                  >
                    VEHICLE NOT READY
                  </Text>

                  <Text style={styles.warning}>
                    Exactly one active registered
                    vehicle must be assigned to this
                    driver before a trip can start.
                  </Text>
                </View>
              )}

              <View style={styles.infoCard}>
                <Text style={styles.label}>
                  START LOCATION / FROM
                </Text>

                <TextInput
                  value={startSearch}
                  onFocus={() =>
                    setStartSearchFocused(true)
                  }
                  onChangeText={value => {
                    setStartSearch(value);
                    setSelectedStartStopId('');
                    setSelectedDestinationStopId('');
                    setSelectedRouteId('');
                    setDestinationSearch('');
                    setDestinationSearchFocused(
                      false,
                    );
                  }}
                  placeholder="Search start location"
                  placeholderTextColor="#6F8498"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={styles.input}
                />

                {startSearchFocused &&
                !selectedStartStopId ? (
                  <View
                    style={
                      styles.suggestionList
                    }
                  >
                    {startSuggestions.length ? (
                      startSuggestions.map(stop => (
                        <Pressable
                          key={stop.id}
                          onPress={() => {
                            setSelectedStartStopId(
                              stop.id,
                            );
                            setStartSearch(
                              stop.name,
                            );
                            setSelectedDestinationStopId(
                              '',
                            );
                            setSelectedRouteId('');
                            setDestinationSearch(
                              '',
                            );
                            setStartSearchFocused(
                              false,
                            );
                          }}
                          style={({ pressed }) => [
                            styles.suggestionItem,
                            pressed &&
                              styles.suggestionPressed,
                          ]}
                        >
                          <Text
                            style={
                              styles.suggestionName
                            }
                          >
                            {stop.name}
                          </Text>

                          {stop.cityMunicipality ||
                          stop.province ? (
                            <Text
                              style={
                                styles.suggestionMeta
                              }
                            >
                              {[
                                stop.cityMunicipality,
                                stop.province,
                              ]
                                .filter(Boolean)
                                .join(', ')}
                            </Text>
                          ) : null}
                        </Pressable>
                      ))
                    ) : (
                      <Text
                        style={
                          styles.suggestionEmpty
                        }
                      >
                        No valid database location
                        found.
                      </Text>
                    )}
                  </View>
                ) : null}

                <Text style={styles.label}>
                  DESTINATION / TO
                </Text>

                <TextInput
                  value={destinationSearch}
                  editable={Boolean(
                    selectedStartStopId,
                  )}
                  onFocus={() =>
                    setDestinationSearchFocused(
                      true,
                    )
                  }
                  onChangeText={value => {
                    setDestinationSearch(value);
                    setSelectedDestinationStopId(
                      '',
                    );
                    setSelectedRouteId('');
                  }}
                  placeholder={
                    selectedStartStopId
                      ? 'Search destination'
                      : 'Select START LOCATION first'
                  }
                  placeholderTextColor="#6F8498"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={styles.input}
                />

                {destinationSearchFocused &&
                selectedStartStopId &&
                !selectedDestinationStopId ? (
                  <View
                    style={
                      styles.suggestionList
                    }
                  >
                    {destinationSuggestions.length ? (
                      destinationSuggestions.map(
                        stop => (
                          <Pressable
                            key={stop.id}
                            onPress={() => {
                              setSelectedDestinationStopId(
                                stop.id,
                              );
                              setDestinationSearch(
                                stop.name,
                              );
                              setSelectedRouteId('');
                              setDestinationSearchFocused(
                                false,
                              );
                            }}
                            style={({
                              pressed,
                            }) => [
                              styles.suggestionItem,
                              pressed &&
                                styles.suggestionPressed,
                            ]}
                          >
                            <Text
                              style={
                                styles.suggestionName
                              }
                            >
                              {stop.name}
                            </Text>

                            {stop.cityMunicipality ||
                            stop.province ? (
                              <Text
                                style={
                                  styles.suggestionMeta
                                }
                              >
                                {[
                                  stop.cityMunicipality,
                                  stop.province,
                                ]
                                  .filter(Boolean)
                                  .join(', ')}
                              </Text>
                            ) : null}
                          </Pressable>
                        ),
                      )
                    ) : (
                      <Text
                        style={
                          styles.suggestionEmpty
                        }
                      >
                        No valid destination is
                        available from this start
                        location.
                      </Text>
                    )}
                  </View>
                ) : null}

                {matchingRoutes.length > 1 &&
                !selectedRoute ? (
                  <View
                    style={styles.routeResolved}
                  >
                    <Text style={styles.label}>
                      SELECT OPERATING ROUTE
                    </Text>

                    {matchingRoutes.map(route => {
                      const viaStops =
                        routeViaStops(route);

                      return (
                        <Pressable
                          key={route.id}
                          onPress={() =>
                            setSelectedRouteId(
                              route.id,
                            )
                          }
                          style={({ pressed }) => [
                            styles.suggestionItem,
                            pressed &&
                              styles.suggestionPressed,
                          ]}
                        >
                          <Text
                            style={
                              styles.suggestionName
                            }
                          >
                            {route.name}
                          </Text>

                          <Text
                            style={
                              styles.suggestionMeta
                            }
                          >
                            {viaStops.length
                              ? `Via: ${viaStops
                                  .map(
                                    stop =>
                                      stop.name,
                                  )
                                  .join(' → ')}`
                              : 'Direct route'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}

                {selectedRoute ? (
                  <View
                    style={styles.routeResolved}
                  >
                    <Text style={styles.label}>
                      OPERATING ROUTE
                    </Text>

                    <Text
                      style={styles.routeName}
                    >
                      {selectedRoute.name}
                    </Text>

                    <Text style={styles.muted}>
                      {selectedRoute.direction}
                    </Text>

                    <Text style={styles.routeViaLabel}>
                      VIA
                    </Text>

                    <Text style={styles.routeVia}>
                      {routeViaStops(
                        selectedRoute,
                      ).length
                        ? routeViaStops(
                            selectedRoute,
                          )
                            .map(
                              stop => stop.name,
                            )
                            .join(' → ')
                        : 'Direct route'}
                    </Text>

                    {matchingRoutes.length > 1 ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          setSelectedRouteId('')
                        }
                        style={({ pressed }) => [
                          styles.changeRoute,
                          pressed &&
                            styles.suggestionPressed,
                        ]}
                      >
                        <Text
                          style={
                            styles.changeRouteText
                          }
                        >
                          CHANGE ROUTE
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>

              {operations &&
              !operations.compliance.eligible ? (
                <View
                  style={styles.complianceBox}
                >
                  <Text
                    style={
                      styles.complianceTitle
                    }
                  >
                    TRIP CANNOT START
                  </Text>

                  <Text
                    style={styles.warning}
                  >
                    {operations.compliance
                      .message ??
                      'Driver requirements are not currently satisfied.'}
                  </Text>
                </View>
              ) : null}

              {permissionNotice ? (
                <View style={styles.infoBox}>
                  <Text
                    style={styles.warning}
                  >
                    {permissionNotice}
                  </Text>
                </View>
              ) : null}

              <Action
                label={
                  busy
                    ? 'PLEASE WAIT…'
                    : 'START TRIP'
                }
                disabled={
                  busy ||
                  !online ||
                  !operations ||
                  !operations.compliance
                    .eligible ||
                  !registeredVehicle ||
                  !selectedStartStopId ||
                  !selectedDestinationStopId ||
                  !selectedRoute
                }
                onPress={() =>
                  void begin()
                }
              />

              <Text
                style={styles.footerNote}
              >
                GPS tracking starts
                automatically when the trip
                begins.
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/*
 * Reusable action button.
 */
function Action({
  label,
  disabled,
  danger = false,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        danger && styles.actionDanger,
        disabled &&
          styles.actionDisabled,
        pressed &&
          !disabled &&
          styles.actionPressed,
      ]}
    >
      <Text
        style={[
          styles.actionText,
          danger &&
            styles.actionDangerText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/*
 * Error message.
 */
function ErrorBox({
  message,
}: {
  message: string;
}) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>
        {message}
      </Text>
    </View>
  );
}

/*
 * Styles.
 */
const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },

  safe: {
    flex: 1,
    backgroundColor: '#07192D',
  },

  container: {
    padding: 18,
    paddingBottom: 40,
  },

  loginContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 22,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },

  logo: {
    color: '#D8B45A',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 3,
  },

  loginHeader: {
    alignItems: 'center',
    marginBottom: 28,
  },

  loginTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 2,
    marginTop: 8,
  },

  loginSubtitle: {
    color: '#A9B7C7',
    fontSize: 13,
    marginTop: 5,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },

  headerSubtitle: {
    color: '#A9B7C7',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 2,
  },

  logoutButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#34495E',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  logoutText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },

  statusBar: {
    minHeight: 38,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },

  statusOnline: {
    backgroundColor: '#102D25',
  },

  statusOffline: {
    backgroundColor: '#38201F',
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },

  dotOnline: {
    backgroundColor: '#55D68A',
  },

  dotOffline: {
    backgroundColor: '#E66A62',
  },

  statusText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },

  card: {
    backgroundColor: '#0D2742',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1B3B59',
    padding: 16,
    marginBottom: 14,
  },

  infoCard: {
    backgroundColor: '#0D2742',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1B3B59',
    padding: 16,
    marginBottom: 14,
  },

  label: {
    color: '#8FA4B8',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 8,
  },

  input: {
    height: 52,
    backgroundColor: '#07192D',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#29445E',
    color: '#FFFFFF',
    paddingHorizontal: 14,
    marginBottom: 12,
    fontSize: 15,
  },

  suggestionList: {
    backgroundColor: '#07192D',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#29445E',
    marginTop: -6,
    marginBottom: 16,
    overflow: 'hidden',
  },

  suggestionItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1B3B59',
  },

  suggestionPressed: {
    opacity: 0.7,
  },

  suggestionName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },

  suggestionMeta: {
    color: '#8FA4B8',
    fontSize: 11,
    marginTop: 3,
  },

  suggestionEmpty: {
    color: '#8FA4B8',
    fontSize: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },

  routeResolved: {
    borderTopWidth: 1,
    borderTopColor: '#1B3B59',
    paddingTop: 14,
    marginTop: 2,
  },

  muted: {
    color: '#9BAFC1',
    fontSize: 13,
    lineHeight: 19,
  },

  vehicleName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 4,
  },

  plate: {
    color: '#D8B45A',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },

  routeName: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
    marginBottom: 4,
  },

  routeViaLabel: {
    color: '#8FA4B8',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginTop: 14,
    marginBottom: 5,
  },

  routeVia: {
    color: '#D8B45A',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },

  changeRoute: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 6,
  },

  changeRouteText: {
    color: '#D8B45A',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },

  activeHeader: {
    marginBottom: 14,
    paddingVertical: 4,
  },

  activeTitle: {
    color: '#55D68A',
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: 1,
  },

  activeSubtitle: {
    color: '#A9B7C7',
    fontSize: 13,
    marginTop: 4,
  },

  startHeader: {
    marginBottom: 18,
  },

  startTitle: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '900',
  },

  startSubtitle: {
    color: '#A9B7C7',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },

  occupancyCard: {
    backgroundColor: '#102C45',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#284C68',
    padding: 18,
    marginBottom: 14,
    alignItems: 'center',
  },

  occupancyValue: {
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 1,
  },

  fullText: {
    color: '#F06C64',
  },

  vacantText: {
    color: '#55D68A',
  },

  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },

  buttonHalf: {
    flex: 1,
  },

  action: {
    minHeight: 58,
    borderRadius: 12,
    backgroundColor: '#D8B45A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginBottom: 12,
  },

  actionDanger: {
    backgroundColor: '#C94C48',
  },

  actionDisabled: {
    opacity: 0.42,
  },

  actionPressed: {
    opacity: 0.78,
    transform: [
      {
        scale: 0.99,
      },
    ],
  },

  actionText: {
    color: '#07192D',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
  },

  actionDangerText: {
    color: '#FFFFFF',
  },

  complianceBox: {
    backgroundColor: '#38201F',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#713B38',
    padding: 14,
    marginBottom: 14,
  },

  complianceTitle: {
    color: '#F08A82',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 5,
  },

  infoBox: {
    backgroundColor: '#142C3D',
    borderRadius: 12,
    padding: 13,
    marginBottom: 14,
  },

  gpsCard: {
    backgroundColor: '#0B2238',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1D405D',
    padding: 14,
    marginBottom: 14,
  },

  gpsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  gpsStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  gpsStatusText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },

  warning: {
    color: '#F0C978',
    fontSize: 12,
    lineHeight: 18,
  },

  footerNote: {
    textAlign: 'center',
    color: '#71879A',
    fontSize: 11,
    marginTop: 4,
    marginBottom: 18,
  },

  errorBox: {
    backgroundColor: '#3A2020',
    borderWidth: 1,
    borderColor: '#75403E',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },

  errorText: {
    color: '#FFAAA4',
    fontSize: 13,
    lineHeight: 19,
  },
});
