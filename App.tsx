import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import SignatureScreen from 'react-native-signature-canvas';
import type { SignatureViewRef } from 'react-native-signature-canvas';

type User = {
  id: number;
  username: string;
  nombre: string;
  rol: string;
  es_admin: boolean;
};

type Sensibilizacion = {
  id: number;
  nombre: string;
  entidad_nombre: string;
  estado: string;
  estado_label: string;
  puede_registrar: boolean;
  fecha_inicio: string | null;
  semestre_label: string;
  ano: number;
  tema: string;
  ubicacion: string;
  jornada_activa: boolean;
  total_registros_propios: number;
  conjunto: {
    nombre: string;
    direccion: string;
    estructura_vivienda: string;
    utiliza_codigo_residente: boolean;
  };
};

type PendingRecord = {
  local_id: string;
  user_id: number;
  sensibilizacion_id: number;
  nombre_completo: string;
  tipo_asistente: string;
  celular: string;
  codigo: string;
  vivienda_torre_bloque: string;
  vivienda_unidad: string;
  direccion_complementaria: string;
  direccion: string;
  observaciones: string;
  firma_data: string;
  autorizacion_datos: boolean;
  idempotency_key: string;
  offline_created_at: string;
};

const SESSION_KEY = 'heroes.mobile.session';
const PENDING_KEY = 'heroes.mobile.pending.records';
const DEFAULT_BASE_URL = 'https://heroesdelplaneta.co';
const REQUEST_TIMEOUT_MS = 15000;

const emptyRecord = {
  nombre_completo: '',
  tipo_asistente: 'hombre',
  celular: '',
  codigo: '',
  vivienda_torre_bloque: '',
  vivienda_unidad: '',
  direccion_complementaria: '',
  direccion: '',
  observaciones: '',
};

function cleanBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function localId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isAbortError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    (('name' in error && error.name === 'AbortError') ||
      ('message' in error && typeof error.message === 'string' && error.message.toLowerCase().includes('canceled')))
  );
}

function isNetworkError(error: unknown) {
  return error instanceof TypeError || (error instanceof Error && error.message === 'Network request failed');
}

function pendingLabel(count: number) {
  return `${count} pendiente${count === 1 ? '' : 's'}`;
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [sensibilizaciones, setSensibilizaciones] = useState<Sensibilizacion[]>([]);
  const [selected, setSelected] = useState<Sensibilizacion | null>(null);
  const [pending, setPending] = useState<PendingRecord[]>([]);
  const [record, setRecord] = useState(emptyRecord);
  const [signature, setSignature] = useState('');
  const [signatureOpen, setSignatureOpen] = useState(false);
  const signatureRef = useRef<SignatureViewRef>(null);
  const [joining, setJoining] = useState({ nombre_completo: '', numero_cedula: '' });
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const apiBase = useMemo(() => cleanBaseUrl(baseUrl), [baseUrl]);
  const selectedPending = pending.filter(
    item => user && selected && item.user_id === user.id && item.sensibilizacion_id === selected.id,
  );

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    async function boot() {
      try {
        const [sessionRaw, pendingRaw] = await Promise.all([
          AsyncStorage.getItem(SESSION_KEY),
          AsyncStorage.getItem(PENDING_KEY),
        ]);
        if (pendingRaw) setPending(JSON.parse(pendingRaw));
        if (sessionRaw) {
          const session = JSON.parse(sessionRaw);
          setBaseUrl(session.baseUrl || DEFAULT_BASE_URL);
          setToken(session.token || '');
          setUser(session.user || null);
        }
      } catch {
        setMessage('No fue posible cargar la sesión guardada.');
      } finally {
        setLoading(false);
      }
    }
    boot();
  }, []);

  useEffect(() => {
    if (token) loadSensibilizaciones();
  }, [token]);

  useEffect(() => {
    AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending)).catch(() => undefined);
  }, [pending]);

  async function request(path: string, options: RequestInit = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    };
    try {
      const response = await fetch(`${apiBase}${path}`, { ...options, headers, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || (payload.errors || []).join('\n') || 'No fue posible completar la solicitud.');
      }
      return payload;
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error('No hubo respuesta del servidor. Si usas Expo Go en celular fisico, usa la IP del computador en la URL del servidor y ejecuta Django con runserver 0.0.0.0:8000.');
      }
      if (isNetworkError(error)) {
        throw new Error('No se pudo conectar con el servidor. Verifica que Django este corriendo con runserver 0.0.0.0:8000 y que la URL use la IP del computador.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function login() {
    if (!apiBase || !username.trim() || !password) {
      Alert.alert('Datos incompletos', 'Ingresa URL del servidor, usuario y contraseña.');
      return;
    }
    setBusy(true);
    try {
      const payload = await request('/api/mobile/login/', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      const session = { baseUrl: apiBase, token: payload.token, user: payload.user };
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
      setToken(payload.token);
      setUser(payload.user);
      setPassword('');
      setMessage('Sesión iniciada correctamente.');
    } catch (error) {
      Alert.alert('No se pudo iniciar sesión', error instanceof Error ? error.message : 'Intenta nuevamente.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await AsyncStorage.removeItem(SESSION_KEY);
    setToken('');
    setUser(null);
    setSelected(null);
    setSensibilizaciones([]);
  }

  async function loadSensibilizaciones() {
    if (!token) return;
    setBusy(true);
    try {
      const payload = await request('/api/mobile/sensibilizaciones/');
      setSensibilizaciones(payload.sensibilizaciones || []);
      setSelected(current => {
        if (!current) return null;
        return (payload.sensibilizaciones || []).find((item: Sensibilizacion) => item.id === current.id) || null;
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo actualizar el listado.');
    } finally {
      setBusy(false);
    }
  }

  async function joinSensibilizacion() {
    if (!selected) return;
    if (!joining.nombre_completo.trim() || !joining.numero_cedula.trim()) {
      Alert.alert('Datos incompletos', 'Ingresa nombre completo y cédula del sensibilizador.');
      return;
    }
    setBusy(true);
    try {
      await request(`/api/mobile/sensibilizaciones/${selected.id}/unirse/`, {
        method: 'POST',
        body: JSON.stringify(joining),
      });
      setJoining({ nombre_completo: '', numero_cedula: '' });
      setMessage('Jornada iniciada. Ya puedes guardar registros offline.');
      await loadSensibilizaciones();
    } catch (error) {
      Alert.alert('No se pudo iniciar jornada', error instanceof Error ? error.message : 'Intenta nuevamente.');
    } finally {
      setBusy(false);
    }
  }

  function updateRecord(field: keyof typeof emptyRecord, value: string) {
    setRecord(current => ({ ...current, [field]: value }));
  }

  function saveOfflineRecord() {
    if (!user || !selected) return;
    if (!record.nombre_completo.trim() || !record.tipo_asistente || !record.direccion.trim() || !signature) {
      Alert.alert('Registro incompleto', 'Nombre, tipo de asistente, dirección y firma son obligatorios.');
      return;
    }
    const newRecord: PendingRecord = {
      ...record,
      local_id: localId(),
      user_id: user.id,
      sensibilizacion_id: selected.id,
      firma_data: signature,
      autorizacion_datos: true,
      idempotency_key: localId(),
      offline_created_at: new Date().toISOString(),
    };
    setPending(current => [newRecord, ...current]);
    setRecord(emptyRecord);
    setSignature('');
    setMessage('Registro guardado en el dispositivo. Sincronízalo cuando haya internet.');
  }

  async function syncPending() {
    if (!selected || !selectedPending.length) return;
    if (!online) {
      Alert.alert('Sin conexión', 'Conéctate a internet antes de sincronizar.');
      return;
    }
    setBusy(true);
    try {
      const payload = await request(`/api/mobile/sensibilizaciones/${selected.id}/registros/sincronizar/`, {
        method: 'POST',
        body: JSON.stringify({ registros: selectedPending }),
      });
      const okKeys = new Set(
        (payload.resultados || [])
          .filter((item: { ok: boolean; idempotency_key: string }) => item.ok)
          .map((item: { idempotency_key: string }) => item.idempotency_key),
      );
      setPending(current => current.filter(item => !okKeys.has(item.idempotency_key)));
      const failed = (payload.resultados || []).filter((item: { ok: boolean }) => !item.ok);
      if (failed.length) {
        Alert.alert('Sincronización parcial', `${okKeys.size} registros subidos. ${failed.length} requieren revisión.`);
      } else {
        setMessage(`${okKeys.size} registros sincronizados correctamente.`);
      }
      await loadSensibilizaciones();
    } catch (error) {
      Alert.alert('No se pudo sincronizar', error instanceof Error ? error.message : 'Intenta nuevamente.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Centered text="Cargando app..." />;
  }

  if (!token || !user) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.authContainer}>
          <Text style={styles.brand}>Héroes del Planeta</Text>
          <Text style={styles.title}>App de sensibilizaciones</Text>
          <Text style={styles.muted}>Inicia sesión con tu usuario sensibilizador y trabaja sin conexión durante la jornada.</Text>
          <TextInput style={styles.input} value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" placeholder="URL del servidor" />
          <Text style={styles.helper}>En Expo Go con celular fisico usa la IP de este computador, por ejemplo http://192.168.1.50:8000.</Text>
          <TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="Usuario" />
          <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Contraseña" />
          <PrimaryButton label={busy ? 'Ingresando...' : 'Iniciar sesión'} onPress={login} disabled={busy} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Sensibilizaciones</Text>
          <Text style={styles.headerSubtitle}>{user.nombre} · {online ? 'Con conexión' : 'Sin conexión'}</Text>
        </View>
        <Pressable onPress={logout} style={styles.logout}><Text style={styles.logoutText}>Salir</Text></Pressable>
      </View>
      {busy && <ActivityIndicator color="#198754" style={styles.loader} />}
      {!!message && <Text style={styles.notice}>{message}</Text>}
      <ScrollView contentContainerStyle={styles.content}>
        {!selected ? (
          <View>
            <PrimaryButton label="Actualizar listado" onPress={loadSensibilizaciones} disabled={busy || !online} />
            {sensibilizaciones.map(item => (
              <Pressable key={item.id} style={styles.card} onPress={() => setSelected(item)}>
                <Text style={styles.cardTitle}>{item.nombre}</Text>
                <Text style={styles.cardStrong}>{item.entidad_nombre}</Text>
                <Text style={styles.muted}>{item.semestre_label} {item.ano} · {item.estado_label}</Text>
                <Text style={styles.muted}>{item.total_registros_propios} registros propios</Text>
              </Pressable>
            ))}
            {!sensibilizaciones.length && <Text style={styles.empty}>No hay sensibilizaciones asignadas.</Text>}
          </View>
        ) : (
          <View>
            <SecondaryButton label="Volver al listado" onPress={() => setSelected(null)} />
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{selected.nombre}</Text>
              <Text style={styles.cardStrong}>{selected.entidad_nombre}</Text>
              <Text style={styles.muted}>{selected.tema}</Text>
              <Text style={styles.badge}>{pendingLabel(selectedPending.length)}</Text>
            </View>
            {!selected.jornada_activa ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Iniciar jornada</Text>
                <TextInput style={styles.input} value={joining.nombre_completo} onChangeText={value => setJoining(current => ({ ...current, nombre_completo: value }))} placeholder="Nombre completo del sensibilizador" />
                <TextInput style={styles.input} value={joining.numero_cedula} onChangeText={value => setJoining(current => ({ ...current, numero_cedula: value }))} keyboardType="number-pad" placeholder="Número de cédula" />
                <PrimaryButton label="Aplicar a la sensibilización" onPress={joinSensibilizacion} disabled={busy || !online} />
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Nuevo registro offline</Text>
                <TextInput style={styles.input} value={record.nombre_completo} onChangeText={value => updateRecord('nombre_completo', value)} placeholder="Nombre completo *" />
                <View style={styles.row}>
                  {[
                    ['hombre', 'Hombre'],
                    ['mujer', 'Mujer'],
                    ['nino', 'Niño'],
                  ].map(([value, label]) => (
                    <Pressable key={value} style={[styles.choice, record.tipo_asistente === value && styles.choiceActive]} onPress={() => updateRecord('tipo_asistente', value)}>
                      <Text style={[styles.choiceText, record.tipo_asistente === value && styles.choiceTextActive]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput style={styles.input} value={record.celular} onChangeText={value => updateRecord('celular', value)} keyboardType="phone-pad" placeholder="Celular" />
                <TextInput style={styles.input} value={record.codigo} onChangeText={value => updateRecord('codigo', value)} placeholder="Código" />
                <TextInput style={styles.input} value={record.direccion} onChangeText={value => updateRecord('direccion', value)} placeholder="Dirección *" />
                <TextInput style={[styles.input, styles.multiline]} value={record.observaciones} onChangeText={value => updateRecord('observaciones', value)} placeholder="Observaciones" multiline />
                <SecondaryButton label={signature ? 'Firma capturada, tocar para repetir' : 'Capturar firma *'} onPress={() => setSignatureOpen(true)} />
                <PrimaryButton label="Guardar en el dispositivo" onPress={saveOfflineRecord} disabled={busy} />
              </View>
            )}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Pendientes por subir</Text>
              <Text style={styles.muted}>{pendingLabel(selectedPending.length)} guardados en este dispositivo.</Text>
              <PrimaryButton label="Sincronizar ahora" onPress={syncPending} disabled={busy || !online || !selectedPending.length} />
            </View>
          </View>
        )}
      </ScrollView>
      <Modal visible={signatureOpen} animationType="slide">
        <SafeAreaView style={styles.signatureModal}>
          <Text style={styles.sectionTitle}>Firma del asistente</Text>
          <SignatureScreen
            ref={signatureRef}
            onOK={value => {
              setSignature(value);
              setSignatureOpen(false);
            }}
            onEmpty={() => Alert.alert('Firma vacía', 'Firma dentro del recuadro antes de guardar.')}
            descriptionText="Firma aquí"
            webStyle=".m-signature-pad { box-shadow: none; border: 1px solid #198754; } .m-signature-pad--footer { display: none; }"
            style={styles.signatureCanvas}
          />
          <View style={styles.signatureActions}>
            <SecondaryButton label="Limpiar" onPress={() => signatureRef.current?.clearSignature()} />
            <PrimaryButton label="Guardar firma" onPress={() => signatureRef.current?.readSignature()} />
          </View>
          <SecondaryButton label="Cancelar" onPress={() => setSignatureOpen(false)} />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Centered({ text }: { text: string }) {
  return (
    <SafeAreaView style={[styles.screen, styles.center]}>
      <ActivityIndicator color="#198754" />
      <Text style={styles.muted}>{text}</Text>
    </SafeAreaView>
  );
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.primaryButton, disabled && styles.buttonDisabled]} onPress={onPress} disabled={disabled}>
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.secondaryButton} onPress={onPress}>
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4fbf6' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  authContainer: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 14 },
  brand: { color: '#198754', fontSize: 32, fontWeight: '900' },
  title: { color: '#133d24', fontSize: 24, fontWeight: '800' },
  muted: { color: '#607568', fontSize: 14, lineHeight: 20 },
  header: { backgroundColor: '#147a45', padding: 18, paddingTop: 22, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  headerSubtitle: { color: '#dff4e6', marginTop: 2 },
  logout: { borderColor: '#fff', borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  logoutText: { color: '#fff', fontWeight: '700' },
  loader: { marginTop: 10 },
  notice: { backgroundColor: '#e9f7ef', color: '#146c43', margin: 12, padding: 10, borderRadius: 10 },
  content: { padding: 14, paddingBottom: 40 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: '#dcefe3', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  cardTitle: { color: '#143d25', fontSize: 18, fontWeight: '800', marginBottom: 4 },
  cardStrong: { color: '#198754', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  sectionTitle: { color: '#143d25', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  badge: { alignSelf: 'flex-start', backgroundColor: '#e9f7ef', color: '#198754', fontWeight: '800', marginTop: 10, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  input: { backgroundColor: '#fff', borderColor: '#b9ddc7', borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 10, color: '#143d25' },
  helper: { color: '#607568', fontSize: 12, lineHeight: 17, marginTop: -4, marginBottom: 8 },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  choice: { flex: 1, borderColor: '#b9ddc7', borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center' },
  choiceActive: { backgroundColor: '#198754', borderColor: '#198754' },
  choiceText: { color: '#198754', fontWeight: '800' },
  choiceTextActive: { color: '#fff' },
  primaryButton: { backgroundColor: '#198754', borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 6, marginBottom: 8 },
  primaryButtonText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  secondaryButton: { borderColor: '#198754', borderWidth: 1, borderRadius: 14, padding: 14, alignItems: 'center', marginBottom: 10 },
  secondaryButtonText: { color: '#198754', fontWeight: '800' },
  buttonDisabled: { opacity: 0.45 },
  empty: { textAlign: 'center', color: '#607568', marginTop: 20 },
  signatureModal: { flex: 1, padding: 16, backgroundColor: '#fff' },
  signatureCanvas: { flex: 1, minHeight: 360 },
  signatureActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
});
