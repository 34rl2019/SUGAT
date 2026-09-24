import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { VehicleMap } from './src/VehicleMap';
import { trackOverview } from '../../packages/shared-utils/src/passenger-tracking';
import { occupancyColor, occupancyLabel, VEHICLE_VERIFICATION_NOTICE } from '@sugat/shared-types';
import {
  deriveLocationFreshness,
  etaForFreshness,
  type Stop,
} from '@sugat/shared-types';
import {
  mobileColors as colors,
  radii,
  spacing,
  SUGAT_BRAND_TAGLINE,
  touchTarget,
} from '@sugat/theme';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { io } from 'socket.io-client';

import { api, SOCKET_URL } from './src/api';
import type { SearchResult, TripDetail } from './src/types';

const FAVORITES = 'sugat.passenger.favorites';
const NOTIFY = 'sugat.passenger.notifications';

const SUGAT_PASSENGER_HEADLINE = 'Where are you going?';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

type Screen =
  | 'home'
  | 'favorites'
  | 'settings';

const stopLabel = (stop: Stop) =>
  [
    stop.name,
    stop.cityMunicipality,
    stop.province,
  ]
    .filter(Boolean)
    .join(' · ');

export default function App() {
  const [screen, setScreen] =
    useState<Screen>('home');

  const [stops, setStops] =
    useState<Stop[]>([]);

  const [from, setFrom] =
    useState<Stop | null>(null);

  const [to, setTo] =
    useState<Stop | null>(null);

  const [results, setResults] =
    useState<SearchResult[]>([]);

  const [detail, setDetail] =
    useState<TripDetail | null>(null);

  const [searchContext,setSearchContext]=useState<{fromStopId:string;toStopId:string;version:number}|null>(null);

  const [picker, setPicker] =
    useState<'from' | 'to' | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState('');

  const [online, setOnline] =
    useState(true);

  const [location, setLocation] =
    useState<Location.LocationObject | null>(null);

  const [favorites, setFavorites] =
    useState<string[]>([]);

  const [notifications, setNotifications] =
    useState(false);

  /*
   * Initial passenger app bootstrap.
   */
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(
      state => {
        setOnline(
          Boolean(
            state.isConnected &&
            state.isInternetReachable !== false,
          ),
        );
      },
    );

    void Promise.all([
      api<Stop[]>('/public/stops')
        .then(setStops),

      AsyncStorage.getItem(FAVORITES)
        .then(value => {
          setFavorites(
            value
              ? JSON.parse(value)
              : [],
          );
        }),

      AsyncStorage.getItem(NOTIFY)
        .then(value => {
          setNotifications(
            value === 'true',
          );
        }),

      Location.requestForegroundPermissionsAsync()
        .then(async permission => {
          if (permission.granted) {
            setLocation(
              await Location.getCurrentPositionAsync({
                accuracy:
                  Location.Accuracy.Balanced,
              }),
            );
          }
        }),
    ])
      .catch(caught => {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Unable to load SUGAT.',
        );
      })
      .finally(() => {
        setLoading(false);
      });

    return unsubscribe;
  }, []);

  /*
   * Live tracking socket.
   *
   * PostgreSQL / HTTP remains authoritative.
   * Socket.IO provides realtime distribution.
   */
  useEffect(() => {
    if (!detail) {
      return;
    }

    const tripId = detail.id;
    const context = detail.trackingContext;

    const query = context
      ? `?boardingStopId=${encodeURIComponent(
          context.boardingStopId,
        )}&destinationStopId=${encodeURIComponent(
          context.destinationStopId,
        )}`
      : '';

    const socket = io(
      `${SOCKET_URL}/live`,
      {
        transports: ['websocket'],
      },
    );

    let lastEtaRefresh = 0;
    let disposed=false;
    let reconciliation:Promise<void>|null=null;

    const reconcile = () => {
      if(reconciliation)return reconciliation;
      lastEtaRefresh = Date.now();

      reconciliation = api<TripDetail>(
        `/public/trips/${tripId}${query}`,
      )
        .then(value => {
          if(!disposed)setDetail(current=>current?.id===tripId?{...value,...(Date.parse(current.location?.recordedAt??'')>(Date.parse(value.location?.recordedAt??'')||0)?{location:current.location}:{}),...(Date.parse(current.occupancyUpdatedAt??'')>(Date.parse(value.occupancyUpdatedAt??'')||0)?{occupancyStatus:current.occupancyStatus,occupancyUpdatedAt:current.occupancyUpdatedAt}:{})}:current);
        })
        .catch(caught => {
          if(!disposed&&caught?.status===404)setDetail(current=>current?.id===tripId?null:current);

          throw caught;
        }).finally(()=>{reconciliation=null});
      return reconciliation;
    };

    const subscribe = () => {
      socket.emit(
        'trip.subscribe',
        {
          tripId,
        },
        (
          acknowledgement: {
            ok: boolean;
            subscribed?: boolean;
            message?: string;
          },
        ) => {
          if(disposed)return;
          if (
            !acknowledgement?.ok ||
            !acknowledgement.subscribed
          ) {
            setError(
              acknowledgement?.message ??
                'Live tracking is unavailable.',
            );
            void reconcile().catch(()=>{});
            return;
          }

          void reconcile()
            .catch(() => {
              setError(
                'Live data reconciliation failed. Please try again.',
              );
            });
        },
      );
    };

    const locationUpdated = (
      payload: any,
    ) => {
      if (
        payload?.tripId !== tripId ||
        !payload.recordedAt
      ) {
        return;
      }

      setDetail(current => {
        if (current?.id !== tripId || Date.parse(payload.recordedAt)<=(Date.parse(current.location?.recordedAt??'')||0)) {
          return current;
        }

        return {
          ...current,

          location: {
            ...payload,

            freshness:
              deriveLocationFreshness(
                payload.recordedAt,
                Date.now(),
                current.freshnessPolicy,
              ),
          },
        };
      });

      if (
        Date.now() -
          lastEtaRefresh >=
        15_000
      ) {
        void reconcile()
          .catch(() => {
            setError(
              'ETA refresh is temporarily unavailable.',
            );
          });
      }
    };

    const occupancy=(event:{tripId:string;occupancyStatus:TripDetail['occupancyStatus'];updatedAt:string})=>{if(event.tripId===tripId)setDetail(current=>current?.id===tripId&&Date.parse(event.updatedAt)>=(Date.parse(current.occupancyUpdatedAt??'')||0)?{...current,occupancyStatus:event.occupancyStatus,occupancyUpdatedAt:event.updatedAt}:current)};
    socket.on('trip.occupancy.updated',occupancy);
    const fallback=setInterval(()=>void reconcile().catch(()=>setError('Tracking updates are temporarily unavailable.')),30000);
    const approaching = (
      payload: any,
    ) => {
      if (!notifications) {
        return;
      }

      void Notifications.scheduleNotificationAsync(
        {
          content: {
            title:
              'SUGAT ride approaching',

            body:
              `${payload.name} is the next approaching stop.`,
          },

          trigger: null,
        },
      );
    };

    const completed = (
      payload: any,
    ) => {
      if (
        payload?.tripId !== tripId
      ) {
        return;
      }

      socket.emit(
        'trip.unsubscribe',
        {
          tripId,
        },
      );

      setDetail(null);

      setError(
        'This trip has completed.',
      );
    };

    const appState =
      AppState.addEventListener(
        'change',
        state => {
          if (
            state !== 'active'
          ) {
            return;
          }

          setDetail(current => {
            if (!current?.location) {
              return current;
            }

            const freshness =
              deriveLocationFreshness(
                current.location.recordedAt,
                Date.now(),
                current.freshnessPolicy,
              );

            if (
              freshness ===
              current.location.freshness
            ) {
              return current;
            }

            return {
              ...current,

              location: {
                ...current.location,
                freshness,
              },

              boardingEta:
                etaForFreshness(
                  current.boardingEta,
                  freshness,
                ),

              destinationEta:
                etaForFreshness(
                  current.destinationEta,
                  freshness,
                ),

              remainingTripTime:
                etaForFreshness(
                  current.remainingTripTime,
                  freshness,
                ),
            };
          });

          if (socket.connected) {
            void reconcile()
              .catch(() => {
                setError(
                  'Live data reconciliation failed. Please try again.',
                );
              });
          }
        },
      );

    socket.on(
      'connect',
      subscribe,
    );

    socket.on(
      'trip.location.updated',
      locationUpdated,
    );

    socket.on(
      'trip.stop.approaching',
      approaching,
    );

    socket.on(
      'trip.completed',
      completed,
    );

    return () => {
      disposed=true;clearInterval(fallback);socket.off('trip.occupancy.updated',occupancy);appState.remove();

      socket.off(
        'connect',
        subscribe,
      );

      socket.off(
        'trip.location.updated',
        locationUpdated,
      );

      socket.off(
        'trip.stop.approaching',
        approaching,
      );

      socket.off(
        'trip.completed',
        completed,
      );

      if (socket.connected) {
        socket.emit(
          'trip.unsubscribe',
          {
            tripId,
          },
        );
      }

      socket.disconnect();
    };
  }, [
    detail?.id,
    notifications,
  ]);

  /*
   * Client-side LIVE → STALE → OFFLINE aging.
   */
  useEffect(() => {
    if (!detail?.location) {
      return;
    }

    const timer = setInterval(
      () => {
        setDetail(current => {
          if (!current?.location) {
            return current;
          }

          const freshness =
            deriveLocationFreshness(
              current.location.recordedAt,
              Date.now(),
              current.freshnessPolicy,
            );

          if (
            freshness ===
            current.location.freshness
          ) {
            return current;
          }

          return {
            ...current,

            location: {
              ...current.location,
              freshness,
            },

            boardingEta:
              etaForFreshness(
                current.boardingEta,
                freshness,
              ),

            destinationEta:
              etaForFreshness(
                current.destinationEta,
                freshness,
              ),

            remainingTripTime:
              etaForFreshness(
                current.remainingTripTime,
                freshness,
              ),
          };
        });
      },

      5_000,
    );

    return () =>
      clearInterval(timer);
  }, [
    detail?.id,
    detail?.location?.recordedAt,
  ]);


  useEffect(()=>{
    if(!searchContext)return;
    setLoading(true);setResults([]);
    const socket=io(SOCKET_URL+'/live',{transports:['websocket']});
    const tracker=trackOverview({socket,...searchContext,
      fetchRides:()=>api<SearchResult[]>('/public/trips/search?fromStopId='+searchContext.fromStopId+'&toStopId='+searchContext.toStopId),
      changed:rides=>{setResults(rides);setLoading(false)},
      failed:message=>{setError(message);setLoading(false)},
      completed:id=>setDetail(current=>current?.id===id?null:current)
    });
    const foreground=AppState.addEventListener('change',state=>{if(state==='active')void tracker.refresh()});
    return()=>{foreground.remove();tracker.dispose();socket.disconnect()};
  },[searchContext]);

  async function search() {
    if (
      !from ||
      !to ||
      !online
    ) {
      return;
    }

    setError('');setSearchContext({fromStopId:from.id,toStopId:to.id,version:Date.now()});
  }

  async function openTrip(
    ride: SearchResult,
  ) {
    setLoading(true);
    setError('');

    try {
      const trip =
        await api<TripDetail>(
          `/public/trips/${ride.tripId}?boardingStopId=${encodeURIComponent(
            ride.boardingStop.id,
          )}&destinationStopId=${encodeURIComponent(
            ride.destinationStop.id,
          )}`,
        );

      setDetail(trip);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Trip unavailable.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function toggleFavorite(
    id: string,
  ) {
    const next =
      favorites.includes(id)
        ? favorites.filter(
            value =>
              value !== id,
          )
        : [
            ...favorites,
            id,
          ];

    setFavorites(next);

    await AsyncStorage.setItem(
      FAVORITES,
      JSON.stringify(next),
    );
  }

  async function toggleNotifications(
    value: boolean,
  ) {
    if (value) {
      const permission =
        await Notifications.requestPermissionsAsync();

      if (
        !permission.granted
      ) {
        setError(
          'Notification permission was not granted.',
        );

        return;
      }
    }

    setNotifications(value);

    await AsyncStorage.setItem(
      NOTIFY,
      String(value),
    );
  }

  if (
    loading &&
    !stops.length
  ) {
    return (
      <Shell>
        <View style={styles.center}>
          <ActivityIndicator
            color={colors.gold}
            size="large"
          />

          <Text style={styles.secondary}>
            Loading SUGAT…
          </Text>
        </View>
      </Shell>
    );
  }

  if (detail) {
    return (
      <Shell>
        {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
        <TripScreen
          trip={detail}
          favorite={
            favorites.includes(
              detail.id,
            )
          }
          back={() =>
            setDetail(null)
          }
          toggle={() =>
            void toggleFavorite(
              detail.id,
            )
          }
        />
      </Shell>
    );
  }

  const favoriteResults =
    results.filter(result =>
      favorites.includes(
        result.tripId,
      ),
    );

  return (
    <Shell>
      <View style={styles.app}>
        {!online && (
          <Text
            accessibilityRole="alert"
            style={styles.offline}
          >
            OFFLINE — LIVE DATA MAY BE OUT OF DATE
          </Text>
        )}

        <ScrollView
          contentContainerStyle={
            styles.content
          }
        >
          {screen === 'home' && (
            <>
              <Hero
                title={
                  SUGAT_PASSENGER_HEADLINE
                }
                subtitle="See buses and vans approaching in real time."
              />

              <View
                style={
                  styles.location
                }
              >
                <Text
                  style={
                    styles.eyebrow
                  }
                >
                  CURRENT LOCATION
                </Text>

                <Text
                  style={
                    styles.secondary
                  }
                >
                  {location
                    ? `${location.coords.latitude.toFixed(
                        4,
                      )}, ${location.coords.longitude.toFixed(
                        4,
                      )}`
                    : 'Location unavailable or not permitted'}
                </Text>
              </View>

              <Card>
                <PickerButton
                  label="FROM"
                  stop={from}
                  onPress={() =>
                    setPicker(
                      'from',
                    )
                  }
                />

                <PickerButton
                  label="TO"
                  stop={to}
                  onPress={() =>
                    setPicker(
                      'to',
                    )
                  }
                />

                {from?.id ===
                  to?.id &&
                  from && (
                    <Text
                      style={
                        styles.error
                      }
                    >
                      Choose two different stops.
                    </Text>
                  )}

                <Button
                  label="FIND A RIDE"
                  onPress={() =>
                    void search()
                  }
                  disabled={
                    !from ||
                    !to ||
                    from.id ===
                      to.id ||
                    !online
                  }
                />
              </Card>

              {error ? (
                <Text
                  accessibilityRole="alert"
                  style={
                    styles.error
                  }
                >
                  {error}
                </Text>
              ) : null}

              <Text
                style={
                  styles.section
                }
              >
                ACTIVE RIDES
              </Text>

              {searchContext&&<VehicleMap vehicles={results} stops={stops.filter(stop=>[searchContext.fromStopId,searchContext.toStopId].includes(stop.id))} onSelect={id=>{const ride=results.find(item=>item.tripId===id);if(ride)void openTrip(ride)}}/>}
              {results.length ? (
                results.map(
                  result => (
                    <RideCard
                      key={
                        result.tripId
                      }
                      ride={
                        result
                      }
                      favorite={
                        favorites.includes(
                          result.tripId,
                        )
                      }
                      open={() =>
                        void openTrip(
                          result,
                        )
                      }
                      toggle={() =>
                        void toggleFavorite(
                          result.tripId,
                        )
                      }
                    />
                  ),
                )
              ) : (
                <Empty text="No active rides for this search. Select an origin and destination to begin." />
              )}
            </>
          )}

          {screen ===
            'favorites' && (
            <>
              <Hero
                title="SAVED RIDES"
                subtitle="Your saved trips stay on this device."
                compact
              />

              {favoriteResults.length ? (
                favoriteResults.map(
                  result => (
                    <RideCard
                      key={
                        result.tripId
                      }
                      ride={
                        result
                      }
                      favorite
                      open={() =>
                        void openTrip(
                          result,
                        )
                      }
                      toggle={() =>
                        void toggleFavorite(
                          result.tripId,
                        )
                      }
                    />
                  ),
                )
              ) : (
                <Empty text="No saved active rides. Favorites appear here after a live search." />
              )}
            </>
          )}

          {screen ===
            'settings' && (
            <>
              <Hero
                title="PASSENGER SETTINGS"
                subtitle="Control location and approaching-stop alerts."
                compact
              />

              <Card>
                <View
                  style={
                    styles.setting
                  }
                >
                  <View
                    style={
                      styles.grow
                    }
                  >
                    <Text
                      style={
                        styles.cardTitle
                      }
                    >
                      Approaching alerts
                    </Text>

                    <Text
                      style={
                        styles.secondary
                      }
                    >
                      Local alerts while tracking a selected trip.
                    </Text>
                  </View>

                  <Switch
                    value={
                      notifications
                    }
                    onValueChange={
                      value =>
                        void toggleNotifications(
                          value,
                        )
                    }
                    trackColor={{
                      true:
                        colors.gold,
                    }}
                  />
                </View>

                <Text
                  style={
                    styles.note
                  }
                >
                  SUGAT does not require a passenger account. Server push registration and passenger profiles are not provided by the current API.
                </Text>
              </Card>
            </>
          )}
        </ScrollView>

        <View style={styles.nav}>
          {(
            [
              'home',
              'favorites',
              'settings',
            ] as Screen[]
          ).map(item => (
            <Pressable
              accessibilityRole="tab"
              key={item}
              onPress={() =>
                setScreen(item)
              }
              style={[
                styles.navItem,
                screen === item &&
                  styles.navActive,
              ]}
            >
              <Text
                style={[
                  styles.navText,
                  screen ===
                    item &&
                    styles.navTextActive,
                ]}
              >
                {item.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>

        <StopModal
          visible={Boolean(
            picker,
          )}
          title={
            picker === 'from'
              ? 'Choose origin'
              : 'Choose destination'
          }
          stops={stops}
          close={() =>
            setPicker(null)
          }
          select={stop => {
            if (
              picker === 'from'
            ) {
              setFrom(stop);
            } else {
              setTo(stop);
            }

            setPicker(null);
          }}
        />
      </View>
    </Shell>
  );
}

function Shell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={styles.safe}
      >
        <StatusBar
          style="light"
          backgroundColor={
            colors.navy
          }
        />

        {children}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Brand() {
  return (
    <View
      style={
        styles.textBrand
      }
    >
      <Text
        style={
          styles.brand
        }
      >
        SUGAT
      </Text>

      <Text
        style={
          styles.brandTagline
        }
      >
        {SUGAT_BRAND_TAGLINE}
      </Text>
    </View>
  );
}

function Hero({
  title,
  subtitle,
  compact = false,
}: {
  title: string;
  subtitle: string;
  compact?: boolean;
}) {
  return (
    <View
      accessibilityLabel="SUGAT passenger search introduction"
      style={[
        styles.hero,
        compact &&
          styles.heroCompact,
      ]}
    >
      <View
        style={
          styles.heroCopy
        }
      >
        <Brand />

        <Text
          style={[
            styles.heroTitle,
            {
              marginTop:
                spacing.lg,
            },
          ]}
        >
          {title}
        </Text>

        <Text
          style={
            styles.heroSubtitle
          }
        >
          {subtitle}
        </Text>
      </View>

      {!compact && (
        <View
          accessibilityElementsHidden
          style={
            styles.routeAccent
          }
        >
          <View
            style={
              styles.routeDot
            }
          />

          <View
            style={
              styles.routeStroke
            }
          />

          <View
            style={
              styles.routeDot
            }
          />
        </View>
      )}
    </View>
  );
}

function Card({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <View
      style={styles.card}
    >
      {children}
    </View>
  );
}

function PickerButton({
  label,
  stop,
  onPress,
}: {
  label: string;
  stop: Stop | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${
        stop
          ? stopLabel(stop)
          : 'not selected'
      }`}
      onPress={onPress}
      style={styles.picker}
    >
      <Text
        style={
          styles.eyebrow
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.pickerValue
        }
      >
        {stop
          ? stopLabel(stop)
          : 'Search active stops'}
      </Text>
    </Pressable>
  );
}

function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,

        (
          pressed ||
          disabled
        ) &&
          styles.dim,
      ]}
    >
      <Text
        style={
          styles.buttonText
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

function RideCard({
  ride,
  favorite,
  open,
  toggle,
}: {
  ride: SearchResult;
  favorite: boolean;
  open: () => void;
  toggle: () => void;
}) {
  return (
    <Card>
      <View style={styles.row}>
        <View
          style={styles.grow}
        >
          <Text
            style={
              styles.status
            }
          >
            {ride.vehicle.type}
            {' · '}
            {'GPS '+ride.freshness+' · '+occupancyLabel(ride.occupancyStatus)}
          </Text>

          <Text
            style={
              styles.cardTitle
            }
          >
            {ride.vehicle.displayName}
          </Text>

          <Text
            style={
              styles.secondary
            }
          >
            {ride.route.name}
            {' · '}
            {ride.route.direction}
          </Text>

          <Text
            style={
              styles.note
            }
          >
            {ride.boardingEta.display}
            {' to '}
            {ride.boardingStop.name}

            {ride.distanceKm == null
              ? ''
              : ` · ${ride.distanceKm} km`}
          </Text>
        </View>

        <Pressable
          accessibilityLabel={
            favorite
              ? 'Remove favorite'
              : 'Add favorite'
          }
          onPress={toggle}
        >
          <Text
            style={
              styles.favorite
            }
          >
            {favorite
              ? '★'
              : '☆'}
          </Text>
        </Pressable>
      </View>

      <Button
        label="TRACK THIS RIDE"
        onPress={open}
      />
    </Card>
  );
}

function TripScreen({
  trip,
  favorite,
  back,
  toggle,
}: {
  trip: TripDetail;
  favorite: boolean;
  back: () => void;
  toggle: () => void;
}) {
  return (
    <ScrollView
      style={styles.trip}
      contentContainerStyle={
        styles.content
      }
    >
      <Pressable
        onPress={back}
      >
        <Text
          style={styles.back}
        >
          ← BACK TO RIDES
        </Text>
      </Pressable>

      <Hero
        title={
          trip.vehicle.displayName
        }
        subtitle={`${trip.route.name} · ${trip.route.direction}`}
        compact
      />

      <VehicleMap vehicles={[{...trip,tripId:trip.id}]} stops={trip.route.stops.map(entry=>entry.stop)} onSelect={()=>{}} route/>
      <Card><Text style={styles.section}>VEHICLE DETAILS</Text><Text style={styles.cardTitle}>{trip.vehicle.displayName}</Text><Text style={styles.cardTitle}>Plate number: {trip.vehicle.plateNumber}</Text><Text style={styles.secondary}>Vehicle type: {trip.vehicle.type}</Text>{trip.vehicle.conductionSticker&&<Text style={styles.secondary}>Conduction sticker: {trip.vehicle.conductionSticker}</Text>}<Text style={{color:occupancyColor(trip.occupancyStatus),fontWeight:'800'}}>{occupancyLabel(trip.occupancyStatus)}</Text></Card>
      <Card><Text style={[styles.note,{borderLeftWidth:3,borderLeftColor:colors.gold,paddingLeft:12}]}>{VEHICLE_VERIFICATION_NOTICE}</Text></Card>

      <Card>
        <View style={styles.row}>
          <View
            style={styles.grow}
          >
            <Text
              style={
                styles.status
              }
            >
              {trip.status}
              {' · GPS '}
              {trip.location?.freshness ??
                'OFFLINE'}
            </Text>

            <Text
              style={
                styles.cardTitle
              }
            >
              Boarding ETA:{' '}
              {trip.boardingEta
                ?.display ??
                'Unavailable'}
            </Text>

            <Text
              style={
                styles.secondary
              }
            >
              Destination ETA:{' '}
              {trip.destinationEta
                ?.display ??
                'Unavailable'}
            </Text>

            <Text
              style={
                styles.secondary
              }
            >
              Next:{' '}
              {trip.nextStop
                ?.name ??
                'Final destination'}
            </Text>

            <Text
              style={
                styles.secondary
              }
            >
              Updated{' '}
              {trip.location
                ? new Date(
                    trip.location
                      .recordedAt,
                  ).toLocaleTimeString()
                : '—'}
            </Text>
          </View>

          <Pressable
            onPress={toggle}
          >
            <Text
              style={
                styles.favorite
              }
            >
              {favorite
                ? '★'
                : '☆'}
            </Text>
          </Pressable>
        </View>
      </Card>

      <Card>
        <Text
          style={styles.section}
        >
          ROUTE STOPS
        </Text>

        {trip.route.stops.map(
          item => (
            <Text
              style={
                styles.stop
              }
              key={
                item.stop.id
              }
            >
              {item.sequence}.
              {' '}
              {item.stop.name}
            </Text>
          ),
        )}
      </Card>
    </ScrollView>
  );
}

function StopModal({
  visible,
  title,
  stops,
  close,
  select,
}: {
  visible: boolean;
  title: string;
  stops: Stop[];
  close: () => void;
  select: (stop: Stop) => void;
}) {
  const [
    query,
    setQuery,
  ] = useState('');

  const shown =
    useMemo(
      () =>
        stops.filter(stop =>
          stopLabel(stop)
            .toLowerCase()
            .includes(
              query.toLowerCase(),
            ),
        ),

      [
        stops,
        query,
      ],
    );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={close}
    >
      <SafeAreaView
        style={styles.modal}
      >
        <View style={styles.row}>
          <Text
            style={
              styles.section
            }
          >
            {title}
          </Text>

          <Pressable
            onPress={close}
          >
            <Text
              style={
                styles.back
              }
            >
              CLOSE
            </Text>
          </Pressable>
        </View>

        <TextInput
          autoFocus
          style={styles.input}
          placeholder="Search province, city, or stop"
          placeholderTextColor={
            colors.textMuted
          }
          value={query}
          onChangeText={
            setQuery
          }
        />

        <FlatList
          data={shown}
          keyExtractor={
            item =>
              item.id
          }
          renderItem={({
            item,
          }) => (
            <Pressable
              style={
                styles.stopOption
              }
              onPress={() =>
                select(item)
              }
            >
              <Text
                style={
                  styles.cardTitle
                }
              >
                {item.name}
              </Text>

              <Text
                style={
                  styles.secondary
                }
              >
                {item.cityMunicipality}
                {' · '}
                {item.province}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Empty text="No matching active stops." />
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

function Empty({
  text,
}: {
  text: string;
}) {
  return (
    <View style={styles.empty}>
      <Text
        style={
          styles.secondary
        }
      >
        {text}
      </Text>
    </View>
  );
}

const styles =
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor:
        colors.background,
    },

    app: {
      flex: 1,
      backgroundColor:
        colors.background,
    },

    content: {
      padding:
        spacing.lg,
      gap:
        spacing.lg,
      paddingBottom: 90,
    },

    center: {
      flex: 1,
      alignItems:
        'center',
      justifyContent:
        'center',
      gap:
        spacing.md,
      backgroundColor:
        colors.background,
    },

    hero: {
      position:
        'relative',
      borderRadius:
        radii.lg,
      padding:
        spacing.xl,
      minHeight: 170,
      overflow:
        'hidden',
      justifyContent:
        'center',
      backgroundColor:
        colors.backgroundSecondary,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    heroCopy: {
      zIndex: 1,
      maxWidth: 300,
    },

    heroCompact: {
      minHeight: 135,
    },

    textBrand: {
      gap: 3,
    },

    brand: {
      fontSize: 22,
      fontWeight:
        '900',
      letterSpacing: 3,
      color:
        colors.textPrimary,
    },

    brandTagline: {
      fontSize: 9,
      fontWeight:
        '800',
      letterSpacing: 1.5,
      color:
        colors.gold,
    },

    heroTitle: {
      fontSize: 26,
      lineHeight: 30,
      fontWeight:
        '900',
      color:
        colors.textPrimary,
      maxWidth: 300,
    },

    heroSubtitle: {
      fontSize: 14,
      lineHeight: 20,
      color:
        colors.textSecondary,
      marginTop:
        spacing.sm,
    },

    routeAccent: {
      position:
        'absolute',
      right: -12,
      bottom: 24,
      width: 130,
      flexDirection:
        'row',
      alignItems:
        'center',
      opacity: 0.6,
    },

    routeStroke: {
      height: 3,
      flex: 1,
      backgroundColor:
        colors.gold,
    },

    routeDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 3,
      borderColor:
        colors.gold,
      backgroundColor:
        colors.background,
    },

    location: {
      paddingHorizontal:
        spacing.sm,
    },

    eyebrow: {
      fontSize: 11,
      fontWeight:
        '900',
      letterSpacing: 1.4,
      color:
        colors.textSecondary,
    },

    card: {
      backgroundColor:
        colors.surface,
      borderRadius:
        radii.md,
      padding:
        spacing.lg,
      gap:
        spacing.md,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    picker: {
      minHeight: 64,
      borderWidth: 1,
      borderColor:
        colors.borderStrong,
      borderRadius:
        radii.sm,
      padding:
        spacing.md,
      justifyContent:
        'center',
      gap: 4,
      backgroundColor:
        colors.surfaceElevated,
    },

    pickerValue: {
      fontSize: 15,
      fontWeight:
        '700',
      color:
        colors.textPrimary,
    },

    button: {
      minHeight:
        touchTarget,
      backgroundColor:
        colors.gold,
      borderRadius:
        radii.sm,
      alignItems:
        'center',
      justifyContent:
        'center',
      paddingHorizontal:
        spacing.lg,
    },

    buttonText: {
      color:
        colors.background,
      fontWeight:
        '900',
      letterSpacing: 0.8,
    },

    dim: {
      opacity: 0.45,
    },

    section: {
      fontSize: 18,
      fontWeight:
        '900',
      color:
        colors.textPrimary,
    },

    cardTitle: {
      fontSize: 17,
      fontWeight:
        '800',
      color:
        colors.textPrimary,
    },

    secondary: {
      color:
        colors.textSecondary,
      lineHeight: 20,
    },

    note: {
      fontSize: 12,
      color:
        colors.textMuted,
      lineHeight: 18,
    },

    status: {
      color:
        colors.success,
      fontWeight:
        '900',
      fontSize: 11,
      letterSpacing: 1,
    },

    error: {
      backgroundColor:
        'rgba(228,75,75,.12)',
      borderWidth: 1,
      borderColor:
        'rgba(228,75,75,.35)',
      color:
        colors.danger,
      padding:
        spacing.md,
      borderRadius:
        radii.sm,
    },

    offline: {
      backgroundColor:
        colors.warning,
      color:
        colors.background,
      textAlign:
        'center',
      padding:
        spacing.sm,
      fontSize: 11,
      fontWeight:
        '900',
    },

    row: {
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'space-between',
      gap:
        spacing.md,
    },

    grow: {
      flex: 1,
    },

    favorite: {
      fontSize: 32,
      color:
        colors.gold,
      padding:
        spacing.sm,
    },

    nav: {
      position:
        'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: 68,
      flexDirection:
        'row',
      backgroundColor:
        colors.surface,
      borderTopWidth: 1,
      borderTopColor:
        colors.border,
    },

    navItem: {
      flex: 1,
      alignItems:
        'center',
      justifyContent:
        'center',
      minHeight:
        touchTarget,
    },

    navActive: {
      borderTopWidth: 3,
      borderTopColor:
        colors.gold,
    },

    navText: {
      fontSize: 10,
      fontWeight:
        '900',
      color:
        colors.textMuted,
    },

    navTextActive: {
      color:
        colors.gold,
    },

    trip: {
      flex: 1,
      backgroundColor:
        colors.background,
    },

    back: {
      color:
        colors.info,
      fontWeight:
        '900',
      paddingVertical:
        spacing.sm,
    },

    map: {
      height: 300,
      borderRadius:
        radii.lg,
      overflow:
        'hidden',
      backgroundColor:
        colors.surfaceElevated,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    stopMarker: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor:
        colors.background,
      borderWidth: 3,
      borderColor:
        colors.gold,
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    stopMarkerInner: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor:
        colors.gold,
    },

    vehicleMarker: {
      minWidth: 44,
      height: 30,
      borderRadius: 8,
      backgroundColor:
        colors.gold,
      borderWidth: 2,
      borderColor:
        colors.background,
      alignItems:
        'center',
      justifyContent:
        'center',
      paddingHorizontal: 6,
    },

    vehicleMarkerText: {
      color:
        colors.background,
      fontSize: 9,
      fontWeight:
        '900',
      letterSpacing: 0.5,
    },

    stop: {
      paddingVertical:
        spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor:
        colors.border,
      color:
        colors.textPrimary,
    },

    modal: {
      flex: 1,
      backgroundColor:
        colors.background,
      padding:
        spacing.lg,
      gap:
        spacing.md,
    },

    input: {
      height: 52,
      borderWidth: 1,
      borderColor:
        colors.borderStrong,
      borderRadius:
        radii.sm,
      backgroundColor:
        colors.surfaceElevated,
      color:
        colors.textPrimary,
      paddingHorizontal:
        spacing.md,
    },

    stopOption: {
      paddingVertical:
        spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor:
        colors.border,
    },

    empty: {
      padding:
        spacing.xl,
      alignItems:
        'center',
      backgroundColor:
        colors.surfaceElevated,
      borderRadius:
        radii.md,
    },

    setting: {
      flexDirection:
        'row',
      justifyContent:
        'space-between',
      alignItems:
        'center',
      gap:
        spacing.md,
    },
  });
