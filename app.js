const STORAGE_KEY = "ciudadela-sombria-jugadores-v1";

// ── Firebase ──────────────────────────────────────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC2lZbjRyP708Tez5XKv7qRI8dRMnGBalY",
  authDomain: "la-flecha-perdida.firebaseapp.com",
  projectId: "la-flecha-perdida",
  storageBucket: "la-flecha-perdida.firebasestorage.app",
  messagingSenderId: "607151809552",
  appId: "1:607151809552:web:806b1b18afe81e8e7f5695"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const STATE_DOC = doc(db, "campana", "estado");

let firestoreReady = false;
let saveTimeout = null;

async function saveState() {
  // Save to localStorage immediately as backup
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  // Mark this tab as the one saving so onSnapshot ignores our own writes
  window._lastSaveAt = Date.now();
  // Debounce Firestore writes (avoid hammering on rapid clicks)
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      const ts = Date.now();
      window._lastSaveAt = ts;
      await setDoc(STATE_DOC, { data: JSON.stringify(state), updatedAt: ts });
    } catch (e) {
      console.warn("Firestore save failed, using localStorage:", e);
    }
  }, 400);
}

async function loadStateFromFirestore() {
  try {
    const snap = await getDoc(STATE_DOC);
    if (snap.exists()) {
      return JSON.parse(snap.data().data);
    }
  } catch (e) {
    console.warn("Firestore load failed, using localStorage:", e);
  }
  return null;
}

function subscribeToChanges() {
  onSnapshot(STATE_DOC, (snap) => {
    if (!snap.exists() || !firestoreReady) return;
    // Skip local echoes of our own writes
    if (snap.metadata.hasPendingWrites) return;
    try {
      const remote = JSON.parse(snap.data().data);
      if (!remote) return;
      const merged = mergeRemoteState(remote);
      state.activity = merged.activity;
      state.characters.forEach((ch) => {
        const remote_ch = merged.characters.find((r) => r.id === ch.id);
        if (remote_ch) {
          ch.stats = { ...ch.stats, ...remote_ch.stats };
          ch.attributes = { ...ch.attributes, ...remote_ch.attributes };
          ch.inventory = remote_ch.inventory || ch.inventory;
          ch.equipped = remote_ch.equipped || ch.equipped;
          ch.currency = remote_ch.currency || ch.currency;
          ch.condition = remote_ch.condition || ch.condition;
          ch.resourceUses = remote_ch.resourceUses || {};
        }
      });
      if (activeCharacterId) renderCharacter();
      else renderHome();
    } catch(e) { console.warn("onSnapshot error:", e); }
  });
}

function mergeRemoteState(saved) {
  if (!saved?.characters) return { characters: clone(initialCharacters), activity: {} };
  const characters = initialCharacters.map((initial) => {
    const stored = saved.characters.find((item) => item.id === initial.id);
    if (!stored) return clone(initial);
    return {
      ...clone(initial),
      ...stored,
      story: initial.story,
      condition: migrateCondition(initial.id, stored.condition, initial.condition),
      memories: clone(initial.memories),
      stats: { ...initial.stats, ...stored.stats },
      attributes: { ...initial.attributes, ...stored.attributes },
      inventory: mergeInventory(initial.id, initial.inventory, stored.inventory || []),
      equipped: normalizeEquipped(stored.equipped ?? clone(initial.equipped || []), mergeInventory(initial.id, initial.inventory, stored.inventory || [])),
      currency: mergeCurrency(initial.currency, stored),
      resourceUses: stored.resourceUses || {},
    };
  });
  return { characters, activity: saved.activity || {} };
}
const EMPTY_CURRENCY = { pc: 0, pp: 0, pe: 0, po: 0, ppt: 0 };
const CURRENCY_LABELS = { pc: "PC", pp: "PP", pe: "PE", po: "PO", ppt: "PPT" };
const SLOT_LABELS = {
  "main-hand": "Mano principal", "off-hand": "Mano secundaria", "two-hands": "Dos manos",
  armor: "Armadura", shield: "Escudo", focus: "Foco", head: "Cabeza", neck: "Cuello",
  body: "Cuerpo", back: "Espalda", belt: "Cinturon", feet: "Pies", hands: "Manos",
  "ring-left": "Anillo izquierdo", "ring-right": "Anillo derecho", other: "Otro",
};
const SLOT_BY_ITEM = {
  "espada-ancestral": "main-hand", "cota-malla": "armor", escudo: "shield", jabalina: "main-hand",
  "simbolo-sagrado": "focus", "martillo-jesucristo": "main-hand", lanza: "main-hand", sombrero: "head",
  "collar-padre": "neck", "arco-largo": "two-hands", "espada-corta": "main-hand", cuero: "armor",
  "carcaj-vaelor": "back", espadon: "two-hands", "hacha-mano": "main-hand", "tatuaje-belfegor": "body",
  tajo: "two-hands", "espada-larga": "main-hand", "calavera-magica": "belt", "tomahawk-enano": "main-hand",
  "ropa-comun": "other", "ropa-viajero": "other",
};

const ITEM_DATABASE = [
  // ══════════════════════════════════════════════════════════════════
  // LA CIUDADELA SOMBRIA — Tesoros oficiales (Cuentos del Portal Bostezante)
  // ══════════════════════════════════════════════════════════════════
  ['bolsa-goblin-z3', 'Bolsa de monedas (goblin)', 'Tesoro', 0.2, 4, 'Contiene 23 PP y 4 PO. Zona 3, cadaver de goblin en el pozo.', 'Ciudadela Sombria'],
  ['flecha-magica', 'Flecha +1', 'Equipo', 0.05, 25, '+1 a impactar y al dano. Hallada en aljaba de esqueleto. Zona 5.', 'Ciudadela Sombria'],
  ['zafiro-pequeno', 'Zafiro pequeno (10 PO)', 'Tesoro', 0.05, 10, 'Piedra preciosa azul intenso. Habia cinco en el barril de mephits. Zona 12.', 'Ciudadela Sombria'],
  ['ficha-pluma-quaal', 'Ficha de pluma de Quaal (arbol)', 'Tesoro', 0.1, 75, 'Objeto magico: invoca un arbol grande. Pertenecia a Yusdrayl. Zona 15.', 'Ciudadela Sombria'],
  ['pergamino-abrir', 'Pergamino de abrir', 'Consumible', 0.1, 50, 'Nivel 2: abre cerraduras o desbloquea objetos cerrados magicamente. Zona 15.', 'Ciudadela Sombria'],
  ['pergamino-armadura-mago', 'Pergamino de armadura de mago', 'Consumible', 0.1, 50, 'Nivel 1: CA 13 + Destreza para el objetivo durante 8 horas. Zona 15.', 'Ciudadela Sombria'],
  ['pergamino-trepar', 'Pergamino de trepar cual aracnido', 'Consumible', 0.1, 50, 'Nivel 2: el objetivo puede escalar paredes y techos durante 1 hora. Zona 15.', 'Ciudadela Sombria'],
  ['elixir-salud', 'Elixir de salud (3 dosis)', 'Consumible', 0.5, 120, 'Cada dosis elimina: ceguera, sordera, paralisis o veneno. Zona 15.', 'Ciudadela Sombria'],
  ['figurita-jade-pequena', 'Figurita de jade de dragon (15 PO)', 'Tesoro', 0.2, 15, 'Figura menuda de jade con forma de dragon. Cuatro sobre el altar + una quinta en el pozo. Zona 21.', 'Ciudadela Sombria'],
  ['figurita-jade-grande', 'Figurita de jade de dragon (20 PO)', 'Tesoro', 0.5, 20, 'Figurita de jade mayor, en el nido de Calcryx. Zona 35.', 'Ciudadela Sombria'],
  ['caliz-cristal', 'Caliz de cristal (5 PO)', 'Tesoro', 0.3, 5, 'Caliz fino de cristal del nido de Calcryx. Zona 35.', 'Ciudadela Sombria'],
  ['vajilla-plata', 'Pieza de vajilla de plata elegante (1 PO)', 'Tesoro', 0.2, 1, 'Una pieza de la vajilla fina de plata del nido de Calcryx. Habia 24 en total. Zona 35.', 'Ciudadela Sombria'],
  ['estuche-khundrukar', 'Estuche de pergamino de Khundrukar', 'Tesoro', 0.2, 100, 'Estuche de hueso con inscripcion "Khundrukar" en runas enanas. Vale 100 PO en comunidades enanas. Zona 35.', 'Ciudadela Sombria'],
  ['anillo-oro-zafiro', 'Anillo de oro con zafiro (25 PO)', 'Tesoro', 0.1, 25, 'Anillo de oro con zafiro incrustado. Perdido en el pozo de los bandidos goblins. Zona 36.', 'Ciudadela Sombria'],
  ['jarra-plata-enana', 'Jarra de plata de manufactura enana (50 PO)', 'Tesoro', 1, 50, 'Jarra de plata con trabajo fino enano. Contiene vino goblin asqueroso. Zona 32.', 'Ciudadela Sombria'],
  ['anillo-karakas', 'Anillo de oro de Karakas (10 PO)', 'Tesoro', 0.1, 10, 'Anillo de oro con nombre de Karakas grabado en el dedo del explorador muerto. Zona 30.', 'Ciudadela Sombria'],
  ['piedra-preciosa-25', 'Piedra preciosa (25 PO)', 'Tesoro', 0.05, 25, 'Gema hallada entre los restos de los exploradores. Habia tres (25 PO cada una). Zona 30.', 'Ciudadela Sombria'],
  ['pergamino-fuego-faerico', 'Pergamino de fuego faerico', 'Consumible', 0.1, 50, 'Nivel 1: rodea de luz faerica a criaturas u objetos. Da ventaja en ataques contra ellos. 1 minuto. Zona 41.', 'Ciudadela Sombria'],
  ['pergamino-retirada', 'Pergamino de retirada expeditiva', 'Consumible', 0.1, 50, 'Nivel 1: accion adicional para correr o saltar durante 10 minutos. Zona 41.', 'Ciudadela Sombria'],
  ['estatua-agata-corellon', 'Estatua de agata de Corellon Larethian (30 PO)', 'Tesoro', 0.5, 30, 'Estatua delicada de agata que representa a la deidad elfa Corellon Larethian. Zona 42.', 'Ciudadela Sombria'],
  ['daga-ceremonial', 'Daga ceremonial (125 PO)', 'Equipo', 1, 125, 'Daga de elaboracion exquisita con decoracion ceremonial. Del sacerdote dragon.', 'Ciudadela Sombria'],
  ['anillo-plata-sacerdote', 'Anillo de plata (15 PO)', 'Tesoro', 0.1, 15, 'Anillo de plata ornamentado. Habia dos en el sarcofago del sacerdote dragon.', 'Ciudadela Sombria'],
  ['amuleto-plata-sacerdote', 'Amuleto de plata (15 PO)', 'Tesoro', 0.2, 15, 'Amuleto de plata con motivos draconicos. Hallado en el sarcofago del sacerdote dragon.', 'Ciudadela Sombria'],
  ['pergamino-orden-imperiosa', 'Pergamino de orden imperiosa', 'Consumible', 0.1, 50, 'Nivel 1: criatura objetivo obedece una orden de una sola palabra si falla salvacion de SAB CD 13.', 'Ciudadela Sombria'],
  ['pergamino-curar-n2', 'Pergamino de curar heridas (nv 2)', 'Consumible', 0.1, 150, 'Nivel 2: restaura 2d8+3 PG. Del sarcofago del sacerdote dragon.', 'Ciudadela Sombria'],
  ['pergamino-infligir-n2', 'Pergamino de infligir heridas (nv 2)', 'Consumible', 0.1, 150, 'Nivel 2 de contacto: inflige 4d10 de dano necrotico. Del sarcofago del sacerdote dragon.', 'Ciudadela Sombria'],
  ['pergamino-saeta-n2', 'Pergamino de saeta guia (nv 2)', 'Consumible', 0.1, 150, 'Nivel 2: 4d6 radiante y ventaja en siguiente ataque contra el objetivo. Del sarcofago.', 'Ciudadela Sombria'],
  ['pocion-resistencia-fuego', 'Pocion de resistencia (fuego)', 'Consumible', 0.5, 150, 'Resistencia al dano de fuego durante 1 hora. Hallada en la sala de la vela.', 'Ciudadela Sombria'],
  ['silbato-llamador-nocturno', 'Silbato Llamador Nocturno', 'Equipo', 0.1, 0, 'Silbato de cristal con nombre en enano. Objeto magico unico. Ver apendice del libro.', 'Ciudadela Sombria'],
  ['varita-enmaranar', 'Varita de enmaranar', 'Equipo', 1, 500, 'Varita magica que lanza enmaranar. Pertenecia a Belak el Paria. Infrecuente.', 'Ciudadela Sombria'],
  ['anillo-sellar-hucrele', 'Anillo de sellar Hucrele (20 PO)', 'Tesoro', 0.1, 20, 'Anillo de oro con sello Hucrele. Lo llevaba Sharwyn. Recompensa 125 PO si se devuelve a Kerowyn.', 'Ciudadela Sombria'],
  ['fruta-curativa', 'Fruta curativa de la Ciudadela', 'Consumible', 0.2, 50, 'Fruta magica del Arbol de Gulthias. Se vende en Oakhurst por unas 50 PO.', 'Ciudadela Sombria'],
  ['antorcha-verde', 'Antorcha de llama permanente (verde)', 'Equipo', 1, 0, 'Antorcha con conjuro de llama permanente de color verde. Objeto magico unico.', 'Ciudadela Sombria'],

  // ══════════════════════════════════════════════════════════════════
  // LA FORJA DE LA FURIA — Tesoros (Cuentos del Portal Bostezante)
  // ══════════════════════════════════════════════════════════════════
  ['lingote-adamantita', 'Lingote de adamantita', 'Tesoro', 5, 500, 'Metal mas duro conocido. Muy valioso para herreros de elite.', 'Forja de la Furia'],
  ['collar-oro-rubies', 'Collar de oro con rubies (900 PO)', 'Tesoro', 0.3, 900, 'Collar de oro con rubies engarzados hallado en la forja sin usar. Zona de la Forja.', 'Forja de la Furia'],
  ['anillo-almacenamiento', 'Anillo de almacenamiento de conjuros', 'Equipo', 0.05, 5000, 'Objeto magico muy raro: almacena conjuros para ser lanzados por el portador.', 'Forja de la Furia'],
  ['rubi-1000po', 'Rubi (1.000 PO)', 'Tesoro', 0.05, 1000, 'Piedra preciosa de color rojo transparente. Hallado en la molleja petrea del lacero.', 'Forja de la Furia'],
  ['esmeralda-500po', 'Esmeralda (500 PO)', 'Tesoro', 0.05, 500, 'Piedra preciosa verde brillante. Habia dos en la molleja del lacero.', 'Forja de la Furia'],
  ['esmeralda-espada', 'Espada larga +1 con esmeralda (110 PO)', 'Equipo', 3, 110, 'Espada larga con incrustacion de esmeralda bañada en plata (110 PO). Zona del esqueleto enano.', 'Forja de la Furia'],
  ['pocion-fuerza-gigante', 'Pocion de fuerza de gigante de colina', 'Consumible', 0.5, 200, 'Fuerza se convierte en 21 durante 1 hora. Infrecuente.', 'Forja de la Furia'],
  ['lingote-hierro-negro', 'Lingote de hierro negro', 'Tesoro', 5, 25, 'Hierro de alta calidad de las forjas profundas.', 'Forja de la Furia'],

  // ══════════════════════════════════════════════════════════════════
  // POCIONES MAGICAS — Valores oficiales DMG (comun/infrecuente = mitad del valor base)
  // ══════════════════════════════════════════════════════════════════
  ['pocion-curacion', 'Pocion de curacion', 'Consumible', 0.5, 50, '2d4+2 PG al beberla. Comun (50 PO).', 'General'],
  ['pocion-curacion-mayor', 'Pocion de curacion mayor', 'Consumible', 0.5, 250, '4d4+4 PG al beberla. Infrecuente (250 PO).', 'General'],
  ['pocion-curacion-superior', 'Pocion de curacion superior', 'Consumible', 0.5, 2500, '8d4+8 PG al beberla. Rara (2.500 PO).', 'General'],
  ['pocion-curacion-suprema', 'Pocion de curacion suprema', 'Consumible', 0.5, 25000, '10d4+20 PG al beberla. Muy rara (25.000 PO).', 'General'],
  ['antitonxina', 'Antitoxina (vial)', 'Consumible', 0.1, 50, 'Ventaja en tiradas de salvacion contra veneno durante 1 hora. No afecta a muertos vivientes.', 'General'],
  ['agua-bendita', 'Agua bendita (frasco)', 'Consumible', 1, 25, '2d6 radiante a infernales y muertos vivientes. Cuesta crear: 1 h + 25 PO en plata en polvo + espacio nivel 1.', 'General'],
  ['aceite-frasco', 'Aceite (frasco)', 'Consumible', 1, 0.1, 'Inflige 5 de fuego adicional si el objetivo recibe dano de fuego en 1 minuto. Cubre 5 pies cuadrados.', 'General'],
  ['acido-vial', 'Acido (vial)', 'Consumible', 0.5, 25, 'Ataque a distancia improvisado: 2d6 de dano de acido si impacta.', 'General'],
  ['veneno-basico', 'Veneno basico (vial)', 'Consumible', 0, 100, 'Aplica en arma o municion. CD 10 CON o 1d4 veneno.', 'General'],
  ['fuego-alquimista', 'Fuego de alquimista (frasco)', 'Consumible', 1, 50, 'Ataque a distancia: 1d4 de fuego por asalto hasta extinguirlo con accion. Dura hasta ser apagado.', 'General'],

  // ══════════════════════════════════════════════════════════════════
  // ARMADURAS — Precios oficiales PHB
  // ══════════════════════════════════════════════════════════════════
  ['armadura-acolchada', 'Armadura acolchada', 'Equipo', 8, 5, 'CA 11 + Des. Ligera. Desventaja en Sigilo.', 'General'],
  ['armadura-cuero', 'Armadura de cuero', 'Equipo', 10, 10, 'CA 11 + Des. Ligera.', 'General'],
  ['armadura-cuero-tachonado', 'Armadura de cuero tachonado', 'Equipo', 13, 45, 'CA 12 + Des. Ligera.', 'General'],
  ['camisa-malla', 'Camisa de malla', 'Equipo', 20, 50, 'CA 13 + Des (max 2). Media.', 'General'],
  ['cota-escamas', 'Cota de escamas', 'Equipo', 45, 50, 'CA 14 + Des (max 2). Media. Desventaja en Sigilo.', 'General'],
  ['coraza', 'Coraza', 'Equipo', 20, 400, 'CA 14 + Des (max 2). Media.', 'General'],
  ['media-armadura', 'Media armadura', 'Equipo', 20, 750, 'CA 15 + Des (max 2). Media. Desventaja en Sigilo.', 'General'],
  ['pieles', 'Pieles', 'Equipo', 45, 10, 'CA 12 + Des (max 2). Media.', 'General'],
  ['armadura-bandas', 'Armadura de bandas', 'Equipo', 55, 200, 'CA 17. Pesada. Fuerza 15. Desventaja en Sigilo.', 'General'],
  ['cota-guarnecida', 'Cota guarnecida', 'Equipo', 40, 30, 'CA 14. Pesada. Desventaja en Sigilo.', 'General'],
  ['cota-malla', 'Cota de malla', 'Equipo', 55, 75, 'CA 16. Pesada. Fuerza 13. Desventaja en Sigilo.', 'General'],
  ['armadura-placas', 'Armadura de placas', 'Equipo', 65, 1500, 'CA 18. Pesada. Fuerza 15. Desventaja en Sigilo.', 'General'],
  ['escudo', 'Escudo', 'Equipo', 6, 10, '+2 CA mientras lo empunas. Requiere una mano.', 'General'],

  // ══════════════════════════════════════════════════════════════════
  // ARMAS SENCILLAS CUERPO A CUERPO — Precios oficiales PHB
  // ══════════════════════════════════════════════════════════════════
  ['baston', 'Baston', 'Equipo', 4, 0.2, '1d6 contundente. Versatil (1d8). 2 PP.', 'General'],
  ['daga', 'Daga', 'Equipo', 1, 2, '1d4 perforante. Arrojadiza (6/18 m), ligera, sutil.', 'General'],
  ['garrote', 'Garrote', 'Equipo', 2, 0.1, '1d4 contundente. Ligero. 1 PP.', 'General'],
  ['garrote-grande', 'Garrote grande', 'Equipo', 10, 0.2, '1d8 contundente. A dos manos. 2 PP.', 'General'],
  ['hacha-mano', 'Hacha de mano', 'Equipo', 2, 5, '1d6 cortante. Arrojadiza (6/18 m), ligera.', 'General'],
  ['hoz', 'Hoz', 'Equipo', 2, 1, '1d4 cortante. Ligera.', 'General'],
  ['jabalina', 'Jabalina', 'Equipo', 2, 0.5, '1d6 perforante. Arrojadiza (9/36 m). 5 PP.', 'General'],
  ['lanza', 'Lanza', 'Equipo', 3, 1, '1d6 perforante. Arrojadiza (6/18 m), versatil (1d8).', 'General'],
  ['martillo-ligero', 'Martillo ligero', 'Equipo', 2, 2, '1d4 contundente. Arrojadizo (6/18 m), ligero.', 'General'],
  ['maza', 'Maza', 'Equipo', 4, 5, '1d6 contundente.', 'General'],

  // ARMAS SENCILLAS A DISTANCIA
  ['arco-corto', 'Arco corto', 'Equipo', 2, 25, '1d6 perforante. Municion (24/96 m), a dos manos.', 'General'],
  ['ballesta-ligera', 'Ballesta ligera', 'Equipo', 5, 25, '1d8 perforante. Municion (24/96 m), a dos manos, recarga.', 'General'],
  ['dardo', 'Dardo', 'Equipo', 0.25, 0.05, '1d4 perforante. Arrojadizo (6/18 m), sutil. 5 PE cada uno.', 'General'],
  ['honda', 'Honda', 'Equipo', 0, 0.1, '1d4 contundente. Municion (9/36 m). 1 PP.', 'General'],

  // ARMAS MARCIALES CUERPO A CUERPO
  ['alabarda', 'Alabarda', 'Equipo', 6, 20, '1d10 cortante. A dos manos, gran alcance, pesada.', 'General'],
  ['cimitarra', 'Cimitarra', 'Equipo', 3, 25, '1d6 cortante. Ligera, sutil.', 'General'],
  ['espada-corta', 'Espada corta', 'Equipo', 2, 10, '1d6 perforante. Ligera, sutil.', 'General'],
  ['espada-larga', 'Espada larga', 'Equipo', 3, 15, '1d8 cortante. Versatil (1d10).', 'General'],
  ['espadon', 'Espadon', 'Equipo', 6, 50, '2d6 cortante. A dos manos, pesada.', 'General'],
  ['estoque', 'Estoque', 'Equipo', 2, 25, '1d8 perforante. Sutil.', 'General'],
  ['flagelo', 'Flagelo', 'Equipo', 2, 10, '1d8 contundente.', 'General'],
  ['guja', 'Guja', 'Equipo', 6, 20, '1d10 cortante. A dos manos, gran alcance, pesada.', 'General'],
  ['hacha-dos-manos', 'Hacha a dos manos', 'Equipo', 7, 30, '1d12 cortante. A dos manos, pesada.', 'General'],
  ['hacha-guerra', 'Hacha de guerra', 'Equipo', 4, 10, '1d8 cortante. Versatil (1d10).', 'General'],
  ['lanza-caballeria', 'Lanza de caballeria', 'Equipo', 6, 10, '1d12 perforante. Gran alcance, especial. Desventaja a 1.5 m o sin montura.', 'General'],
  ['latigo', 'Latigo', 'Equipo', 3, 2, '1d4 cortante. Gran alcance, sutil.', 'General'],
  ['lucero-alba', 'Lucero del alba', 'Equipo', 4, 15, '1d8 perforante.', 'General'],
  ['martillo-guerra', 'Martillo de guerra', 'Equipo', 2, 15, '1d8 contundente. Versatil (1d10).', 'General'],
  ['maza-dos-manos', 'Maza a dos manos', 'Equipo', 10, 10, '2d6 contundente. A dos manos, pesada.', 'General'],
  ['pica', 'Pica', 'Equipo', 18, 5, '1d10 perforante. A dos manos, gran alcance, pesada.', 'General'],
  ['pico-guerra', 'Pico de guerra', 'Equipo', 2, 5, '1d8 perforante.', 'General'],
  ['tridente', 'Tridente', 'Equipo', 4, 5, '1d6 perforante. Arrojadizo (6/18 m), versatil (1d8).', 'General'],
  ['red', 'Red', 'Equipo', 3, 1, 'Especial: atrapa criaturas de tamano Grande o menor. Arrojadiza (1.5/4.5 m). 1 PO.', 'General'],

  // ARMAS MARCIALES A DISTANCIA
  ['arco-largo', 'Arco largo', 'Equipo', 2, 50, '1d8 perforante. Municion (45/180 m), a dos manos, pesado.', 'General'],
  ['ballesta-mano', 'Ballesta de mano', 'Equipo', 3, 75, '1d6 perforante. Ligera, municion (9/36 m), recarga.', 'General'],
  ['ballesta-pesada', 'Ballesta pesada', 'Equipo', 18, 50, '1d10 perforante. A dos manos, municion (30/120 m), pesada, recarga.', 'General'],
  ['cerbatana', 'Cerbatana', 'Equipo', 1, 10, '1 perforante. Municion (7.5/30 m), recarga.', 'General'],

  // ══════════════════════════════════════════════════════════════════
  // EQUIPO DE AVENTUREROS — Precios oficiales PHB
  // ══════════════════════════════════════════════════════════════════
  ['abrojos', 'Abrojos (bolsa)', 'Consumible', 2, 1, 'Cubre 3x3 m. CD 15 DES o 1 perforante y velocidad -3 m hasta recuperar 1 PG. 1 PO.', 'General'],
  ['aljaba', 'Aljaba', 'Utilidad', 1, 1, 'Contiene hasta 20 flechas.', 'General'],
  ['anillo-sellar', 'Anillo de sellar', 'Utilidad', 0, 5, 'Sello personal para lacrar documentos. 5 PO.', 'General'],
  ['ariete-portatil', 'Ariete portatil', 'Utilidad', 35, 4, '+4 en pruebas de Fuerza para echar puertas abajo. Ventaja si un aliado ayuda.', 'General'],
  ['balanza-mercader', 'Balanza de mercader', 'Utilidad', 3, 5, 'Pesa objetos hasta 5 lb. Util para valorar mercancias.', 'General'],
  ['bolas-metal', 'Bolas de metal (bolsa)', 'Consumible', 2, 1, 'Cubre 3x3 m. CD 10 DES o derribado. A media velocidad no hay tirada.', 'General'],
  ['bolsa', 'Bolsa', 'Utilidad', 0.5, 0.5, 'Contiene hasta 20 balas de honda o 50 dardos. 5 PP.', 'General'],
  ['botella-cristal', 'Botella de cristal', 'Utilidad', 2, 2, 'Contenedor de vidrio de calidad. 2 PO.', 'General'],
  ['cadena', 'Cadena (3 m)', 'Utilidad', 10, 5, 'CD 20 de Fuerza para romper. 5 PO.', 'General'],
  ['campana', 'Campana', 'Utilidad', 0, 1, 'Campana simple de metal. 1 PO.', 'General'],
  ['candelabro', 'Candelabro', 'Utilidad', 1, 5, 'Sostiene velas. 5 PP.', 'General'],
  ['cantimplora', 'Cantimplora', 'Utilidad', 5, 0.2, 'Capacidad 4 litros de liquido. 2 PP.', 'General'],
  ['catalejo', 'Catalejo', 'Utilidad', 1, 1000, 'Objetos a distancia parecen 2 veces mas cercanos. 1.000 PO.', 'General'],
  ['cerradura', 'Cerradura', 'Utilidad', 1, 10, 'CD 15 con herramientas de ladron para abrir sin llave.', 'General'],
  ['cesta', 'Cesta', 'Utilidad', 2, 0.4, 'Contenedor de mimbre. 4 PP.', 'General'],
  ['cofre', 'Cofre', 'Utilidad', 25, 5, 'Contenedor de madera y metal. 5 PO.', 'General'],
  ['cuerda-canamo', 'Cuerda de canamo (15 m)', 'Consumible', 10, 1, 'Aguanta 1.000 lb. Se gasta con el uso. 1 PO.', 'General'],
  ['cuerda-seda', 'Cuerda de seda (15 m)', 'Consumible', 5, 10, 'Aguanta 750 lb. Mas ligera. 10 PO.', 'General'],
  ['cubo', 'Cubo', 'Utilidad', 2, 0.5, 'Cubo de metal o madera. 5 PP.', 'General'],
  ['escalera', 'Escalera (3 m)', 'Utilidad', 25, 0.1, 'Escalera de madera de 10 pies (3 m). 1 PP.', 'General'],
  ['espejo-acero', 'Espejo de acero', 'Utilidad', 0.5, 5, 'Ver alrededor de esquinas o en oscuridad con luz. 5 PO.', 'General'],
  ['esposas', 'Esposas', 'Utilidad', 6, 2, 'CD 20 de Des con herramientas de ladron para escapar. CD 20 FUE para romper. 2 PO.', 'General'],
  ['estuche-mapa', 'Estuche para mapa o pergamino', 'Utilidad', 1, 1, 'Tubo cilindrco de cuero para proteger documentos. 1 PO.', 'General'],
  ['garfio-escalada', 'Garfio de escalada', 'Utilidad', 4, 2, 'Gancho de hierro para asegurar cuerda a salientes. 2 PO.', 'General'],
  ['jabon', 'Jabon', 'Consumible', 0, 0.02, 'Barra de jabon. 2 PE.', 'General'],
  ['lampara', 'Lampara', 'Utilidad', 1, 0.5, 'Ilumina 4.5 m de luz brillante y 9 m de tenue. 1 hora por frasco de aceite. 5 PP.', 'General'],
  ['linterna-ojo-buey', 'Linterna de ojo de buey', 'Utilidad', 2, 10, 'Cono de 18 m de luz brillante y 18 m de tenue. 6 horas por frasco de aceite. 10 PO.', 'General'],
  ['linterna-sorda', 'Linterna sorda', 'Utilidad', 2, 5, 'Esfera de 6 m de luz brillante y 6 m de tenue. 6 horas por frasco de aceite. 5 PO.', 'General'],
  ['lupa', 'Lupa', 'Utilidad', 0, 100, 'Ventaja en pruebas de Percepcion o Historia para examinar objetos pequenos. 100 PO.', 'General'],
  ['manta', 'Manta', 'Utilidad', 3, 0.5, 'Manta de lana gruesa. 5 PP.', 'General'],
  ['martillo', 'Martillo', 'Utilidad', 3, 1, 'Clava pitones y realiza reparaciones basicas. 1 PO.', 'General'],
  ['mazo', 'Mazo (herramienta)', 'Utilidad', 10, 2, 'Martillo grande de madera. 2 PO.', 'General'],
  ['mochila', 'Mochila', 'Utilidad', 5, 2, 'Capacidad: 30 lb o 0.03 m3. 2 PO.', 'General'],
  ['odre', 'Odre', 'Utilidad', 5, 0.2, 'Capacidad: 4 litros. 2 PP.', 'General'],
  ['olla-hierro', 'Olla de hierro', 'Utilidad', 10, 1, 'Para cocinar. 1 PO.', 'General'],
  ['pala', 'Pala', 'Utilidad', 5, 2, 'Para cavar. 2 PO.', 'General'],
  ['palanqueta', 'Palanqueta', 'Utilidad', 5, 2, 'Ventaja en pruebas de Fuerza para abrir objetos. 2 PO.', 'General'],
  ['papel-hoja', 'Papel (hoja)', 'Utilidad', 0, 0.2, 'Hoja de papel de calidad. 2 PP.', 'General'],
  ['perfume-vial', 'Perfume (vial)', 'Utilidad', 0, 5, 'Fragancia de calidad en vial pequeno. 5 PO.', 'General'],
  ['pergamino-hoja', 'Pergamino (hoja)', 'Utilidad', 0, 0.1, 'Hoja de pergamino para escribir. 1 PP.', 'General'],
  ['petate', 'Petate', 'Utilidad', 7, 0.1, 'Para descanso. Necesario para descanso largo en la naturaleza. 1 PP.', 'General'],
  ['pico-minero', 'Pico de minero', 'Utilidad', 10, 2, 'Para excavar roca. 2 PO.', 'General'],
  ['piedra-afilar', 'Piedra de afilar', 'Utilidad', 1, 0.01, 'Afila armas metalicas. 1 PE.', 'General'],
  ['pinchos-hierro', 'Pinchos de hierro (10)', 'Utilidad', 5, 1, 'Para bloquear puertas o asegurar objetos. 1 PO.', 'General'],
  ['piton', 'Piton', 'Consumible', 0.25, 0.05, 'Clavo de hierro para asegurar cuerda. 5 PE.', 'General'],
  ['pluma-escribir', 'Pluma (para escribir)', 'Utilidad', 0, 0.02, 'Pluma de ave para escritura. 2 PE.', 'General'],
  ['polipasto', 'Polipasto', 'Utilidad', 10, 1, 'Polea para izar cargas pesadas. 1 PO.', 'General'],
  ['raciones', 'Raciones (1 dia)', 'Consumible', 2, 0.5, 'Comida seca para un dia de viaje. 5 PP.', 'General'],
  ['reloj-arena', 'Reloj de arena', 'Utilidad', 1, 25, 'Mide intervalos de tiempo de 1 hora. 25 PO.', 'General'],
  ['ropas-comunes', 'Ropas comunes', 'Equipo', 3, 0.5, 'Vestimenta cotidiana sencilla. 5 PP.', 'General'],
  ['ropas-calidad', 'Ropas de calidad', 'Equipo', 6, 15, 'Ropa de buena confeccion para eventos formales. 15 PO.', 'General'],
  ['ropas-viaje', 'Ropas de viaje', 'Equipo', 4, 2, 'Ropa resistente y comoda para el camino. 2 PO.', 'General'],
  ['ropas-disfraz', 'Ropas de disfraz', 'Equipo', 3, 1, 'Ropa variada para crear disfraces. 1 PO.', 'General'],
  ['saco', 'Saco', 'Utilidad', 0.5, 0.01, 'Saco de tela o cuero. 1 PE.', 'General'],
  ['saquito-componentes', 'Saquito de componentes', 'Utilidad', 2, 25, 'Bolsa con materiales para lanzar conjuros. 25 PO.', 'General'],
  ['silbato-supervivencia', 'Silbato de supervivencia', 'Utilidad', 0, 0.05, 'Silbato de metal audible a gran distancia. 5 PE.', 'General'],
  ['tienda-dos-personas', 'Tienda para dos personas', 'Utilidad', 20, 2, 'Refugio portatil para dos. 2 PO.', 'General'],
  ['tinta-botella', 'Tinta (botella de 1 onza)', 'Utilidad', 0, 10, 'Tinta negra de calidad. 10 PO.', 'General'],
  ['tiza', 'Tiza (1 trozo)', 'Utilidad', 0, 0.01, 'Marca paredes y suelos. 1 PE.', 'General'],
  ['trampa-caza', 'Trampa para cazar', 'Utilidad', 25, 5, 'Inmoviliza criaturas que la pisen. CD 13 FUE para escapar. 5 PO.', 'General'],
  ['tunica', 'Tunica', 'Equipo', 4, 0.1, 'Prenda simple de una pieza. 1 PO.', 'General'],
  ['utensilios-cocina', 'Utensilios de cocina', 'Utilidad', 8, 0.2, 'Olla, platos, cubiertos y utensilios basicos. 2 PP.', 'General'],
  ['utiles-escalada', 'Utiles de escalada', 'Utilidad', 12, 25, 'Garfio, pitones y correas. Ventaja en trepar, descanso en pared. 25 PO.', 'General'],
  ['utiles-sanador', 'Utiles de sanador', 'Utilidad', 3, 5, 'Estabiliza criaturas a 0 PG como accion. 10 usos. 5 PO.', 'General'],
  ['vara', 'Vara (3 m)', 'Utilidad', 7, 0.05, 'Palo largo de 10 pies (3 m). 5 PE.', 'General'],
  ['vela', 'Vela', 'Consumible', 0, 0.01, 'Luz tenue 1.5 m. Dura 1 hora. 1 PE.', 'General'],
  ['vial', 'Vial', 'Utilidad', 0, 1, 'Pequeno contenedor de vidrio hermetico. 1 PO.', 'General'],
  ['yesquero', 'Yesquero', 'Utilidad', 1, 0.5, 'Encender fuego en 1 accion (o 1 min si falla). 5 PP.', 'General'],

  // Municion
  ['flechas', 'Flechas (20)', 'Consumible', 1, 1, 'Municion para arco corto o largo. 1 PO por 20.', 'General'],
  ['virotes', 'Virotes de ballesta (20)', 'Consumible', 1.5, 1, 'Municion para ballesta. 1 PO por 20.', 'General'],
  ['balas-honda', 'Balas de honda (20)', 'Consumible', 1.5, 0.04, 'Municion para honda. 4 PE por 20.', 'General'],
  ['dardos-cerbatana', 'Dardos de cerbatana (50)', 'Consumible', 1, 1, 'Municion para cerbatana. 1 PO por 50.', 'General'],

  // Canalizadores arcanos (PHB)
  ['cristal-arcano', 'Cristal (canalizador arcano)', 'Equipo', 1, 10, 'Canalizador arcano para conjuros. 10 PO.', 'General'],
  ['baston-arcano', 'Baston (canalizador arcano)', 'Equipo', 4, 5, 'Canalizador arcano de baston. 5 PO.', 'General'],
  ['orbe-arcano', 'Orbe (canalizador arcano)', 'Equipo', 3, 20, 'Canalizador arcano de orbe. 20 PO.', 'General'],
  ['vara-arcana', 'Vara (canalizador arcano)', 'Equipo', 0, 10, 'Canalizador arcano de vara. 10 PO.', 'General'],
  ['varita-arcana', 'Varita (canalizador arcano)', 'Equipo', 0, 10, 'Canalizador arcano de varita. 10 PO.', 'General'],
  ['simbolo-sagrado-amuleto', 'Simbolo sagrado (amuleto)', 'Equipo', 1, 5, 'Foco para conjuros divinos. 5 PO.', 'General'],
  ['simbolo-sagrado-emblema', 'Simbolo sagrado (emblema)', 'Equipo', 0, 5, 'Simbolo divino sobre escudo o armadura. 5 PO.', 'General'],
  ['relicario', 'Relicario (simbolo sagrado)', 'Equipo', 2, 5, 'Pequena caja con icono sagrado. 5 PO.', 'General'],
  ['libro-conjuros', 'Libro de conjuros', 'Utilidad', 3, 50, '6 conjuros de nivel 1 al inicio. Necesario para el mago. 50 PO.', 'General'],

  // ══════════════════════════════════════════════════════════════════
  // HERRAMIENTAS — Precios oficiales PHB
  // ══════════════════════════════════════════════════════════════════
  ['herr-albanil', 'Herramientas de albanil', 'Utilidad', 8, 10, 'Para trabajo con piedra y mortero. 10 PO.', 'General'],
  ['herr-alfarero', 'Herramientas de alfarero', 'Utilidad', 3, 10, 'Para trabajo con arcilla y ceramica. 10 PO.', 'General'],
  ['herr-carpintero', 'Herramientas de carpintero', 'Utilidad', 6, 8, 'Para trabajo con madera. 8 PO.', 'General'],
  ['herr-cartografo', 'Herramientas de cartografo', 'Utilidad', 6, 15, 'Para crear y leer mapas. 15 PO.', 'General'],
  ['herr-curtidor', 'Herramientas de curtidor', 'Utilidad', 5, 5, 'Para trabajo con cuero y pieles. 5 PO.', 'General'],
  ['herr-ebanista', 'Herramientas de ebanista', 'Utilidad', 5, 1, 'Para trabajo con madera fina. 1 PO.', 'General'],
  ['herr-herrero', 'Herramientas de herrero', 'Utilidad', 8, 20, 'Para trabajo con metales. 20 PO.', 'General'],
  ['herr-joyero', 'Herramientas de joyero', 'Utilidad', 2, 25, 'Para trabajo con gemas y metales preciosos. 25 PO.', 'General'],
  ['herr-manitas', 'Herramientas de manitas', 'Utilidad', 10, 50, 'Para reparaciones de todo tipo. 50 PO.', 'General'],
  ['herr-soplador', 'Herramientas de soplador de vidrio', 'Utilidad', 5, 30, 'Para trabajo con vidrio. 30 PO.', 'General'],
  ['herr-tejedor', 'Herramientas de tejedor', 'Utilidad', 5, 1, 'Para tejer telas y prendas. 1 PO.', 'General'],
  ['herr-zapatero', 'Herramientas de zapatero', 'Utilidad', 5, 5, 'Para trabajo con calzado y cuero. 5 PO.', 'General'],
  ['suministros-alquimista', 'Suministros de alquimista', 'Utilidad', 8, 50, 'Para crear pociones y acidos. 50 PO.', 'General'],
  ['suministros-caligrafos', 'Suministros de calígrafos', 'Utilidad', 5, 10, 'Para escritura ornamental y documentos. 10 PO.', 'General'],
  ['suministros-cervecero', 'Suministros de cervecero', 'Utilidad', 9, 20, 'Para elaborar bebidas fermentadas. 20 PO.', 'General'],
  ['suministros-pintor', 'Suministros de pintor', 'Utilidad', 5, 10, 'Para pintar y crear obras de arte. 10 PO.', 'General'],
  ['utiles-cocinero', 'Utiles de cocinero', 'Utilidad', 8, 1, 'Para preparar comida de calidad. 1 PO.', 'General'],
  ['herr-ladron', 'Herramientas de ladron', 'Utilidad', 1, 25, 'Ganzuas y herramientas para cerraduras y trampas. 25 PO.', 'General'],
  ['herr-navegante', 'Herramientas de navegante', 'Utilidad', 2, 25, 'Para navegar y crear rutas maritimas. 25 PO.', 'General'],
  ['utiles-envenenador', 'Utiles de envenenador', 'Utilidad', 2, 50, 'Para crear y aplicar venenos. 50 PO.', 'General'],
  ['utiles-herborista', 'Utiles de herborista', 'Utilidad', 3, 5, 'Para identificar y aplicar hierbas. Necesario para crear antitoxinas y pociones de curacion. 5 PO.', 'General'],
  ['utiles-disfraz', 'Utiles para disfrazarse', 'Utilidad', 3, 25, 'Maquillaje, tinte y accesorios para disfraces. 25 PO.', 'General'],
  ['utiles-falsificar', 'Utiles para falsificar', 'Utilidad', 5, 15, 'Materiales para falsificar documentos. 15 PO.', 'General'],

  // Instrumentos musicales (PHB)
  ['chirimia', 'Chirimia', 'Utilidad', 1, 2, 'Instrumento de viento de madera. 2 PO.', 'General'],
  ['cuerno-musical', 'Cuerno (instrumento)', 'Utilidad', 2, 3, 'Instrumento de viento de metal. 3 PO.', 'General'],
  ['dulcemele', 'Dulcemele', 'Utilidad', 10, 25, 'Instrumento de cuerda percutida. 25 PO.', 'General'],
  ['flauta', 'Flauta', 'Utilidad', 1, 2, 'Instrumento de viento sencillo. 2 PO.', 'General'],
  ['flauta-pan', 'Flauta de pan', 'Utilidad', 2, 12, 'Flauta de varios tubos. 12 PO.', 'General'],
  ['gaita', 'Gaita', 'Utilidad', 6, 30, 'Instrumento de viento con fuelle. 30 PO.', 'General'],
  ['laud', 'Laud', 'Utilidad', 2, 35, 'Instrumento de cuerda pulsada. 35 PO.', 'General'],
  ['lira', 'Lira', 'Utilidad', 2, 30, 'Instrumento de cuerda. 30 PO.', 'General'],
  ['tambor', 'Tambor', 'Utilidad', 3, 6, 'Instrumento de percusion. 6 PO.', 'General'],
  ['viola', 'Viola', 'Utilidad', 1, 30, 'Instrumento de cuerda frotada. 30 PO.', 'General'],

  // ══════════════════════════════════════════════════════════════════
  // MONTURAS Y VEHICULOS — Precios oficiales PHB
  // ══════════════════════════════════════════════════════════════════
  ['burro-mula', 'Burro o mula', 'Utilidad', 0, 8, 'Velocidad 12 m. Capacidad 190 kg. 8 PO.', 'General'],
  ['caballo-guerra', 'Caballo de guerra', 'Utilidad', 0, 400, 'Velocidad 18 m. Capacidad 245 kg. 400 PO.', 'General'],
  ['caballo-monta', 'Caballo de monta', 'Utilidad', 0, 75, 'Velocidad 18 m. Capacidad 218 kg. 75 PO.', 'General'],
  ['caballo-tiro', 'Caballo de tiro', 'Utilidad', 0, 50, 'Velocidad 12 m. Capacidad 245 kg. 50 PO.', 'General'],
  ['camello', 'Camello', 'Utilidad', 0, 50, 'Velocidad 15 m. Capacidad 218 kg. 50 PO.', 'General'],
  ['elefante', 'Elefante', 'Utilidad', 0, 200, 'Velocidad 12 m. Capacidad 600 kg. 200 PO.', 'General'],
  ['mastin', 'Mastin', 'Utilidad', 0, 25, 'Velocidad 12 m. Capacidad 88 kg. 25 PO.', 'General'],
  ['poni', 'Poni', 'Utilidad', 0, 30, 'Velocidad 12 m. Capacidad 102 kg. 30 PO.', 'General'],
  ['alforjas', 'Alforjas', 'Utilidad', 8, 4, 'Par de bolsas para montura. Capacidad 4.5 kg cada una. 4 PO.', 'General'],
  ['carreta', 'Carreta', 'Utilidad', 200, 15, 'Vehiculo de 2 ruedas. Capacidad 91 kg. 15 PO.', 'General'],
  ['carro', 'Carro', 'Utilidad', 400, 35, 'Vehiculo de 4 ruedas. Capacidad 181 kg. 35 PO.', 'General'],
  ['carruaje', 'Carruaje', 'Utilidad', 600, 100, 'Vehiculo cerrado de 4 ruedas para pasajeros. 100 PO.', 'General'],
  ['carro-guerra', 'Carro de guerra', 'Utilidad', 100, 250, 'Vehiculo ligero de combate. 250 PO.', 'General'],
  ['silla-monta', 'Silla de monta', 'Utilidad', 25, 10, 'Para montar a caballo con comodidad. 10 PO.', 'General'],
  ['silla-militar', 'Silla militar', 'Utilidad', 30, 20, 'Ventaja en pruebas para permanecer montado. 20 PO.', 'General'],
  ['silla-exotica', 'Silla exotica', 'Utilidad', 40, 60, 'Para montar en criaturas voladoras o acuaticas. 60 PO.', 'General'],

  // ══════════════════════════════════════════════════════════════════
  // PIEDRAS PRECIOSAS — Valores oficiales DMG
  // ══════════════════════════════════════════════════════════════════
  ['gema-10po', 'Piedra preciosa (10 PO)', 'Tesoro', 0.02, 10, 'Azurita, agata con franjas, cuarzo azul, ojo de agata, hematita, lapislazuli, malaquita, agata musgosa, obsidiana, rodocrosita, ojo de tigre o turquesa.', 'General'],
  ['gema-50po', 'Piedra preciosa (50 PO)', 'Tesoro', 0.02, 50, 'Jaspe sanguineo, cornalina, crisoprasa, citrino, jaspe, piedra de luna, onix, cuarzo, sardonica, cuarzo rosa estrellado o zirconita.', 'General'],
  ['gema-100po', 'Piedra preciosa (100 PO)', 'Tesoro', 0.02, 100, 'Alejandrita, aguamarina, perla negra, espinela azul, peridoto o topacio.', 'General'],
  ['gema-500po', 'Piedra preciosa (500 PO)', 'Tesoro', 0.02, 500, 'Ambar, amatista, crisoberilo, coral, granate, jade, azabache, perla, espinela o turmalina.', 'General'],
  ['gema-1000po', 'Piedra preciosa (1.000 PO)', 'Tesoro', 0.02, 1000, 'Opalo negro, zafiro azul, esmeralda, opalo de fuego, opalo, rubi estrella, zafiro estrella o zafiro amarillo.', 'General'],
  ['gema-5000po', 'Piedra preciosa (5.000 PO)', 'Tesoro', 0.02, 5000, 'Zafiro negro, diamante, jacinto o rubi.', 'General'],
];

// Items that belong in the "Mochila" tab (Historia/Utilidad)
const MOCHILA_CATEGORIES = ["Utilidad", "Historia"];
// Items that belong in the main inventory tab
const ACTIVO_CATEGORIES = ["Equipo", "Consumible", "Tesoro"];

// Convert feet to meters in text
function piesAMetros(text) {
  return text.replace(/(\d+(?:\.\d+)?)\s*pies?/gi, (_, n) => {
    const m = Math.round(parseFloat(n) * 0.3 * 10) / 10;
    return `${m} m`;
  });
}
const WEIGHT_BY_ITEM = {
  "espada-ancestral": 3, "cota-malla": 55, escudo: 6, jabalina: 2, "simbolo-sagrado": 1,
  mochila: 5, petate: 7, "utensilios-cocina": 1, yesquero: 1, antorcha: 1, racion: 2,
  odre: 5, "cuerda-canamo": 10, "ropa-comun": 3, "martillo-jesucristo": 2, lanza: 3,
  sombrero: 0, "collar-padre": 0, "arco-largo": 2, flecha: 0.05, "espada-corta": 2,
  cuero: 10, "carcaj-vaelor": 1, "cuchillo-pequeno": 1, espadon: 6, "hacha-mano": 2,
  "tatuaje-belfegor": 0, palanca: 5, martillo: 3, piton: 0.25, tajo: 6, "espada-larga": 3,
  "calavera-magica": 1, "tomahawk-enano": 2, "herramientas-herrero": 20, "ropa-viajero": 4,
};

const campaign = {
  session: [
    ["Ahora mismo", "El sarcofago quedo abierto", "El sacerdote dragon fallido fue derrotado cuando Galahad tuvo la idea de quemarlo.", "gold"],
    ["Estado del grupo", "Nilux y Galahad agotados", "El orbe musical los hizo correr demasiadas veces entre la sala 7 y la entrada.", "danger"],
    ["Botin conocido", "Antorcha verde eterna", "Encontraron una antorcha de llama verde que no se apaga.", "green"],
    ["Pregunta abierta", "Que le pasa a Calcryx", "El grupo duda de Meepo porque Calcryx lo ataco apenas fue enviada a buscarla.", "muted"],
  ],
  objectives: [
    ["Resuelto", "Calcryx fue devuelta", "La cria de dragon blanco llego viva, amarrada e inconsciente ante Yusdrayl.", "green"],
    ["Resuelto", "Amber esta libre", "Yusdrayl cumplio el trato y libero a Amber despues de recibir a Calcryx.", "green"],
    ["Actual", "Explorar las salas draconicas", "La llave abrio el camino hacia el orbe musical, el acertijo de estrellas y el sarcofago.", "gold"],
  ],
  quests: [
    ["Completada", "El precio de Calcryx", "Calcryx fue recuperada viva, Amber quedo libre y Yusdrayl entrego la llave como recompensa.", "green"],
    ["Activa", "La expedicion perdida", "Descubrir que ocurrio con los aventureros que entraron antes a la Ciudadela.", "gold"],
    ["Completada", "La llave de la cabeza de dragon", "La llave fue recibida de Yusdrayl y usada para abrir la puerta draconica.", "green"],
    ["Activa", "El misterio de Calcryx", "Calcryx ataco a Meepo apenas fue enviado a buscarla. El grupo sospecha que Meepo podria ocultar algo.", "danger"],
    ["Activa", "Las ruinas draconicas", "El orbe, el acertijo de las estrellas, las runas y el sacerdote dragon fallido revelan que estas salas guardan historia antigua.", "gold"],
    ["Rumor", "Una fruta que cura", "En Oakhurst se habla de una fruta extraordinaria capaz de curar a la gente.", "muted"],
    ["Completada", "Descender a la Ciudadela", "La compania encontro la grieta y alcanzo las ruinas hundidas.", "green"],
  ],
  places: [
    ["Oakhurst", "Punto de partida", "La aldea donde comenzo la busqueda de la expedicion desaparecida.", "known"],
    ["La grieta", "Descubierto", "El descenso que conduce hacia la fortaleza hundida.", "known"],
    ["Ruinas de la Ciudadela", "Explorado parcialmente", "Pasillos antiguos, piedra rota y vestigios draconicos bajo tierra.", "known"],
    ["Celda del dragon", "Visitado", "El lugar donde el grupo encontro a Meepo y supo que Calcryx habia desaparecido.", "known"],
    ["Territorio kobold", "Visitado", "La zona habitada por la tribu de Yusdrayl.", "known"],
    ["Trono de Yusdrayl", "Visitado", "Aqui entregaron a Calcryx, Yusdrayl libero a Amber y les dio la llave draconica.", "known"],
    ["Sala de descanso goblin", "Visitada", "El grupo mato goblins y empapo cadaveres con aceite antes de seguir la busqueda.", "known"],
    ["Camara de Calcryx", "Visitada", "Meepo fue enviado hacia Calcryx, ella lo ataco y comenzo el combate que casi tumbo al grupo.", "known"],
    ["Sala del orbe musical", "Visitada", "Nilux encendio la bola. La musica encanto varias veces a Nilux, Miguel Angel y Galahad hasta que el orbe fue destruido.", "known"],
    ["Puerta del acertijo", "Visitada", "Miguel Angel resolvio rapidamente el acertijo draconico con la respuesta: las estrellas.", "known"],
    ["Pozo con espinas", "Visitado", "Al seguir huellas por el camino normal, Miguel Angel cayo en la trampa.", "known"],
    ["Sala del sarcofago", "Ubicacion actual conocida", "Aqui encontraron a Jot, la antorcha verde eterna y el sacerdote dragon fallido.", "current"],
  ],
  lore: [
    ["Ashardalon", "Historia contada por Yusdrayl", "La Ciudadela fue un lugar sagrado dedicado antiguamente a dragones y vinculado con el nombre de Ashardalon."],
    ["La devastacion", "Rumor conocido en Oakhurst", "Algunos aldeanos creen que la desolacion que hundio estas ruinas fue consecuencia de la furia pasada de Ashardalon."],
    ["La fruta curativa", "Rumor conocido en Oakhurst", "Se dice que una fruta extraordinaria relacionada con la Ciudadela ha curado a personas enfermas."],
    ["La llave draconica", "Recompensa de Yusdrayl", "La llave de la cabeza de dragon fue entregada al grupo y abrio el camino hacia salas draconicas antiguas."],
    ["La musica del orbe", "Experiencia directa", "La bola de la sala 7 podia encantar a quienes escuchaban su musica y hacerlos volver una y otra vez."],
    ["Las estrellas", "Acertijo resuelto", "Miguel Angel descubrio que la respuesta al acertijo de la puerta dragon era: las estrellas."],
    ["Sacerdote dragon fallido", "Ruinas draconicas", "Del sarcofago salio una criatura vinculada a los sacerdotes dragon fallidos mencionados por las ruinas. Solo dejo de levantarse cuando fue quemada."],
  ],
  intel: [
    ["Confirmado", "Calcryx fue recuperada", "Galahad la dejo inconsciente con el pomo de su espada y el grupo logro llevarla viva ante Yusdrayl.", "known"],
    ["Confirmado", "Amber fue liberada", "Yusdrayl cumplio su palabra cuando recibio a Calcryx.", "known"],
    ["Confirmado", "El fuego detuvo al sacerdote", "El enemigo del sarcofago seguia levantandose hasta que Galahad propuso quemarlo.", "known"],
    ["Rumor", "La fruta curativa", "En Oakhurst se dice que una fruta de origen misterioso ha curado enfermedades.", "rumor"],
    ["Pendiente", "La expedicion Hucrele", "Kerowyn Hucrele todavia espera respuestas sobre Talgen, Sharwyn y quienes entraron con ellos.", "pending"],
    ["Pendiente", "Meepo y Calcryx", "El grupo no sabe por que Calcryx ataco a Meepo. La sospecha contra el kobold queda abierta.", "pending"],
  ],
  timeline: [
    ["La mision en Oakhurst", "La compania llego a la aldea y acepto investigar la Ciudadela Sombria, donde una expedicion anterior desaparecio."],
    ["El descenso por la grieta", "El grupo bajo hasta una fortaleza hundida y comenzo a recorrer sus ruinas antiguas."],
    ["Meepo y la cria perdida", "En una celda dedicada a dragones, la compania conocio a Meepo y supo que Calcryx habia desaparecido."],
    ["La audiencia con Yusdrayl", "La lider kobold ofrecio un trato: recuperar viva a Calcryx a cambio de liberar a Amber."],
    ["La busqueda de Calcryx", "El grupo evito la trampa de la sala 24, mato goblins en la sala de descanso y encontro el lugar donde estaba Calcryx."],
    ["Aliento de hielo", "Calcryx ataco a Meepo y luego bajo a Miguel Angel y Arthas con su aliento. Galahad la dejo inconsciente con el pomo de su espada."],
    ["Huida con fuego", "Exploradores goblin vieron el desastre y corrieron a avisar a su lider. El grupo escapo encendiendo cadaveres en la entrada de la sala principal goblin."],
    ["El trato cumplido", "Yusdrayl recibio a Calcryx, libero a Amber, entrego la llave y permitio descansar en territorio kobold por 20 PO."],
    ["El orbe musical", "Nilux encendio el orbe de la sala 7. Nilux y Galahad quedaron agotados tras caer varias veces bajo el encantamiento."],
    ["Las estrellas y el sarcofago", "Miguel Angel resolvio el acertijo de la puerta dragon. Luego el grupo encontro a Jot, la antorcha verde eterna y el sarcofago del sacerdote dragon fallido."],
  ],
  npcs: [
    ["Meepo", "Territorio kobold", "Sospechoso para el grupo", "Kobold asustado y lleno de cicatrices. Calcryx lo ataco cuando fue enviado a buscarla, y ahora el grupo duda de el."],
    ["Yusdrayl", "Trono kobold", "Trato cumplido", "Lider orgullosa de la tribu kobold. Recibio a Calcryx, libero a Amber y entrego la llave draconica."],
    ["Calcryx", "Con Yusdrayl", "Criatura recuperada", "Cria de dragon blanco. Casi derrota al grupo con su aliento, pero fue llevada viva e inconsciente hasta el trono kobold."],
    ["Jot", "Salas draconicas", "Burlon fugitivo", "Una criatura invisible que sorprendio a Amber. Al ser encerrado se volvio invisible, tomo forma de murcielago y escapo riendose e insultando al grupo."],
    ["Sacerdote dragon fallido", "Sarcofago", "Amenaza destruida", "Ser surgido del sarcofago. Volvia a levantarse hasta que el grupo lo destruyo con fuego."],
    ["Kerowyn Hucrele", "Oakhurst - Mercante", "Contratante", "Mercante de Oakhurst preocupada por sus hijos Talgen y Sharwyn, desaparecidos tras entrar a la Ciudadela con una expedicion."],
    ["Garon", "Oakhurst - Posada del Viejo Jabali", "Conocido", "Tabernero del Viejo Jabali. Compartio rumores locales sobre la Ciudadela y sus peligros."],
    ["Jefe de caravana", "Conocido antes de la Ciudadela", "Paradero desconocido", "Ayudo a revelar propiedades magicas de algunos objetos especiales. Su historia aun guarda preguntas."],
  ],
  moments: [
    ["El sombrero", "Miguel Angel encontro un sombrero. Le quedaba demasiado bien como para abandonarlo."],
    ["Skully", "Amber viaja con una calavera reanimada que conservo despues de derrotar a un nigromante."],
    ["Una espada que susurra", "Arthas porta una espada ancestral vinculada con una entidad silenciosa."],
    ["El critico de Miguel Angel", "Un golpe brutal dejo aturdida a Calcryx justo antes de que su aliento helado tirara a dos companeros."],
    ["El pomo de Galahad", "Galahad no mato a Calcryx: la dejo inconsciente con un golpe medido del pomo de su espada."],
    ["La fogata goblin", "Para cortar la persecucion, el grupo incendio cadaveres empapados en aceite en la entrada de la sala principal goblin."],
    ["El orbe odioso", "Nilux y Galahad fueron encantados tantas veces que terminaron exhaustos tras correr una y otra vez."],
    ["Jot se fue puteando", "Jot escapo como murcielago, riendose y lanzando insultos mientras el grupo quedaba con las ganas de atraparlo."],
    ["Quemar funciona", "El sacerdote dragon fallido solo dejo de levantarse cuando Galahad penso en prenderlo fuego."],
  ],
  quotes: [
    ["Vaelor", "La mayoria cree que un arquero mata con punteria. Estan equivocados. Mata con paciencia."],
    ["Bitacora de la compania", "Calcryx volvio viva, Amber quedo libre y la llave abrio una parte mas antigua de la Ciudadela."],
    ["Miguel Angel", "El sombrero se veia genial. Eso era suficiente."],
    ["Jot", "No lo atraparon, pero al menos dejo una escena dificil de olvidar."],
  ],
  gallery: [
    ["grupo1.jpeg", "Sobre el abismo", "Ilustracion de la compania reunida en unas ruinas verticales."],
    ["grupo2.jpeg", "Territorio hostil", "Ilustracion del grupo mientras ratas gigantes y goblins observan desde la oscuridad."],
    ["grupo3.jpeg", "Una amenaza helada", "Ilustracion de la compania frente a una enorme dragona blanca. No representa necesariamente a Calcryx."],
    ["grupo-chibi.png", "Los rehenes de la flecha perdida", "Una version bastante menos solemne de la compania, con Meepo intentando sobrevivir a la jornada."],
  ],
};

const initialCharacters = [
  {
    id: "arthas", name: "Arthas Menethil", player: "Checo", initials: "AM", identity: "Paladin humano variante - Nivel 1",
    portrait: "portrait-arthas.jpg",
    appearance: "Humano alto y de porte noble. Cabello blanco ondulado, lentes finos, armadura oscura ornamentada y capa violeta. Su espada ancestral emite energia purpura.",
    story: "Caballero de una orden paladina. Sobrevivio a unas ruinas profundas al tomar una espada ancestral vinculada con una entidad silenciosa.",
    condition: "Recuperado tras el descanso largo. Fue derribado por el aliento helado de Calcryx en la sesion anterior.",
    stats: { level: 1, hp: 12, maxHp: 12, ac: 18, initiative: 0, speed: "30 pies", proficiency: 2, passivePerception: 10 },
    attributes: { Fuerza: 14, Destreza: 10, Constitucion: 14, Inteligencia: 10, Sabiduria: 10, Carisma: 16 },
    attacks: ["Espada ancestral +4 - 1d8 + 2 cortante; efecto adicional especial", "Jabalina +4 - 1d6 + 2 perforante"],
    resources: ["Imponer las manos - 5 PG", "Sentidos divinos - 4 usos por descanso largo", "Dote - Centinela"],
    inventory: [
      ["espada-ancestral", "Espada ancestral", 1, "Equipo", "Espada larga vinculada con una entidad oscura. Inflige 1d6 de dano adicional despues de impactar, pero tambien te inflige 1d6 despues de cada descanso largo. Homebrew.", "main-hand", 3, 0],
      ["cota-malla", "Cota de malla", 1, "Equipo", "Armadura pesada. CA 16. Requiere Fuerza 13. Desventaja en Sigilo.", "armor", 55, 75],
      ["escudo", "Escudo", 1, "Equipo", "+2 CA mientras lo empunas. Requiere una mano libre.", "shield", 6, 10],
      ["jabalina", "Jabalina", 5, "Equipo", "1d6 perforante. Arrojadiza (alcance 9/36 m). Versatil (1d8).", "main-hand", 2, 0.5],
      ["simbolo-sagrado", "Simbolo sagrado", 1, "Equipo", "Amuleto sagrado. Foco para tus conjuros de paladin.", "focus", 1, 5],
      ["mochila", "Mochila", 1, "Utilidad", "Capacidad: 30 lb o 0.03 m3.", "other", 5, 2],
      ["petate", "Petate", 1, "Utilidad", "Para dormir. Necesario para descanso largo en la naturaleza.", "other", 7, 0.1],
      ["utensilios-cocina", "Utensilios de cocina", 1, "Utilidad", "Olla, platos y cubiertos basicos para cocinar.", "other", 8, 0.2],
      ["yesquero", "Yesquero", 1, "Utilidad", "Encender fuego en 1 accion (o 1 minuto si falla la prueba).", "other", 1, 0.5],
      ["antorcha", "Antorcha", 10, "Consumible", "Ilumina 6 m de luz brillante y 6 m de tenue. Dura 1 hora.", "other", 1, 0.01],
      ["racion", "Racion de viaje", 10, "Consumible", "Comida seca para un dia de viaje.", "other", 2, 0.5],
      ["odre", "Odre", 1, "Utilidad", "Contenedor de cuero. Capacidad 4 litros de liquido.", "other", 5, 0.2],
      ["cuerda-canamo", "Cuerda de canamo", 15, "Consumible", "Aguanta 450 kg. Se gasta con el uso. (15 m)", "other", 10, 1],
      ["insignia-rango", "Insignia de rango", 1, "Historia", "Insignia militar de tu trasfondo de soldado. Recuerdo de tu servicio.", "other", 0, 0],
      ["trofeo-enemigo", "Trofeo de un enemigo caido", 1, "Historia", "Objeto tomado de un enemigo derrotado. Recuerdo de una batalla anterior.", "other", 0.5, 0],
      ["dados-hueso", "Dados de hueso", 1, "Historia", "Juego de dados de tu pasado como soldado.", "other", 0, 0.1],
      ["ropa-comun", "Ropa comun", 1, "Equipo", "Vestimenta cotidiana sencilla.", "other", 3, 0.5],
    ],
    currency: { pc: 0, pp: 0, pe: 0, po: 10, ppt: 0 },
    equipped: ["espada-ancestral", "cota-malla", "escudo"],
    recommendations: [
      ["Nivel 2: Golpe divino", "Obtendras espacios de conjuro y Golpe divino. Puedes decidir despues de impactar si gastas el espacio para aumentar el dano."],
      ["Conjuros iniciales", "Bendecir ayuda a tres aliados con ataques y salvaciones. Escudo de la fe mejora la defensa de quien este expuesto."],
      ["Juego tactico", "Centinela te permite castigar enemigos que intenten ignorarte. Procura mantenerte cerca de aliados vulnerables."],
    ],
    memories: ["Naciste en una casa noble menor y creciste bajo ideales estrictos de disciplina, honor y devocion.", "A los diecisiete anos juraste proteger al reino de horrores antiguos ocultos bajo fortalezas y ciudades enterradas.", "En una expedicion, tus companeros perdieron la razon y moriste casi por completo rodeado de criaturas. La espada del altar te pregunto si deseabas vivir.", "Regresaste como el unico sobreviviente. Tus juramentos siguen intactos, pero el vinculo con la entidad dentro del arma se alimenta con cada batalla.", "Calcryx te derribo con su aliento helado antes de que el grupo lograra llevarla viva ante Yusdrayl.", "Un critico bien puesto ayudo a bajar al sacerdote dragon fallido, aunque la criatura siguio levantandose hasta arder."],
  },
  {
    id: "miguel-angel", name: "Miguel Angel", player: "Koko", initials: "MA", identity: "Clerigo de la Guerra, enano - Nivel 1",
    portrait: "portrait-miguel-angel.jpg",
    appearance: "Enano robusto de barba negra, lentes y sombrero marron. Lleva armadura pesada grabada, escudo y un martillo que brilla con luz dorada.",
    story: "Busca justicia contra una iglesia corrupta. Porta su martillo predilecto, un collar heredado de su padre y un sombrero que le quedaba demasiado bien como para abandonarlo.",
    condition: "Recuperado tras el descanso largo. Fue derribado por el aliento helado de Calcryx en la sesion anterior.",
    stats: { level: 1, hp: 11, maxHp: 11, ac: 18, initiative: 1, speed: "25 pies", proficiency: 2, passivePerception: 13 },
    attributes: { Fuerza: 14, Destreza: 12, Constitucion: 15, Inteligencia: 10, Sabiduria: 16, Carisma: 8 },
    attacks: ["Martillo Jesucristo +4 - 1d8 + 2 contundente", "Lanza +4 - 1d6 + 2 perforante"],
    resources: ["Sacerdote de guerra - 3 ataques adicionales por descanso largo", "Conjuros - CD 13, ataque +5", "Espacios de nivel 1 - 2"],
    inventory: [
      ["martillo-jesucristo", "Martillo Jesucristo", 1, "Equipo", "Martillo de guerra personal de Miguel Angel. 1d8 contundente, o 1d10 a dos manos. Versatil.", "main-hand", 2, 15],
      ["lanza", "Lanza", 1, "Equipo", "1d6 perforante. Arrojadiza (alcance 6/18 m). Versatil (1d8).", "main-hand", 3, 1],
      ["cota-malla", "Cota de malla", 1, "Equipo", "Armadura pesada. CA 16. Requiere Fuerza 13. Desventaja en Sigilo.", "armor", 55, 75],
      ["escudo", "Escudo", 1, "Equipo", "Porta el simbolo de tu deidad. +2 CA mientras lo empunas.", "shield", 6, 10],
      ["simbolo-sagrado", "Simbolo sagrado", 1, "Equipo", "Amuleto sagrado. Foco para tus conjuros de clerigo.", "focus", 1, 5],
      ["sombrero", "Sombrero", 1, "Historia", "Lo encontro en la Ciudadela. Le quedaba demasiado bien como para abandonarlo.", "head", 0.5, 0],
      ["collar-padre", "Collar de su padre", 1, "Historia", "El ultimo recuerdo de su padre. Lo lleva bajo la barba.", "neck", 0.1, 0],
      ["mochila", "Mochila", 1, "Utilidad", "Capacidad: 30 lb o 0.03 m3.", "other", 5, 2],
      ["petate", "Petate", 1, "Utilidad", "Para dormir. Necesario para descanso largo.", "other", 7, 0.1],
      ["utensilios-cocina", "Utensilios de cocina", 1, "Utilidad", "Olla, platos y cubiertos basicos.", "other", 8, 0.2],
      ["yesquero", "Yesquero", 1, "Utilidad", "Encender fuego en 1 accion.", "other", 1, 0.5],
      ["antorcha", "Antorcha", 10, "Consumible", "Ilumina 6 m de luz brillante y 6 m de tenue. Dura 1 hora.", "other", 1, 0.01],
      ["racion", "Racion de viaje", 10, "Consumible", "Comida seca para un dia de viaje.", "other", 2, 0.5],
      ["odre", "Odre", 1, "Utilidad", "Contenedor de cuero. Capacidad 4 litros.", "other", 5, 0.2],
      ["cuerda-canamo", "Cuerda de canamo", 15, "Consumible", "Aguanta 450 kg. Se gasta con el uso. (15 m)", "other", 10, 1],
      ["insignia-rango", "Insignia de rango", 1, "Historia", "Insignia militar de tu trasfondo de soldado.", "other", 0, 0],
      ["trofeo-enemigo", "Trofeo de un enemigo caido", 1, "Historia", "Objeto tomado de un enemigo derrotado.", "other", 0.5, 0],
      ["dados-hueso", "Dados de hueso", 1, "Historia", "Juego de dados de tu pasado como soldado.", "other", 0, 0.1],
      ["ropa-comun", "Ropa comun", 1, "Equipo", "Vestimenta cotidiana sencilla.", "other", 3, 0.5],
    ],
    currency: { pc: 0, pp: 0, pe: 0, po: 10, ppt: 0 },
    equipped: ["martillo-jesucristo", "cota-malla", "escudo", "sombrero", "collar-padre"],
    recommendations: [
      ["Nivel 2: Canalizar divinidad", "Obtendras Impacto guiado: tras ver tu tirada puedes sumar +10 a un ataque. Reservalo para un golpe realmente importante."],
      ["Conjuros recomendados", "Bendecir mejora al grupo. Palabra de curacion levanta a un aliado a distancia usando accion adicional. Saeta guia facilita el siguiente ataque contra el objetivo."],
      ["Economia de acciones", "Sacerdote de guerra te permite atacar como accion adicional algunas veces. No puedes usar a la vez Palabra de curacion como accion adicional."],
    ],
    memories: ["El sacerdote que te crio fue asesinado y la iglesia corrupta utilizo el crimen para culparte.", "Descubriste que esa misma institucion contrato a tu padre para un trabajo sucio y fue responsable de su muerte.", "Bajo tu barba llevas un collar, el ultimo recuerdo de tu padre. Tu escudo porta el simbolo de tu deidad como una promesa de justicia.", "Tu sombrero no es un misterio profundo: lo encontraste, se veia genial y te lo quedaste.", "Tu martillo personal se llama Jesucristo.", "Tu critico dejo aturdida a Calcryx, aunque su aliento helado te mando a 0 PG poco despues.", "Resolviste rapidamente el acertijo de la puerta dragon con la respuesta: las estrellas.", "Caiste en el pozo con espinas al seguir las huellas por el camino normal."],
  },
  {
    id: "nilux", name: "Nilux", player: "Vasito", initials: "NI", identity: "Explorador elfo de los bosques - Nivel 1",
    portrait: "portrait-nilux.jpg",
    appearance: "Elfo de los bosques delgado, de cabello oscuro y expresion concentrada. Usa cuero oscuro, capa verde, arco largo y el Carcaj de Vaelor.",
    story: "Arquero criado entre los Edena Ruh, una troupe errante. Porta el Carcaj de Vaelor y busca escribir su propia historia.",
    condition: "Agotamiento nivel 1 por caer demasiadas veces bajo el encanto del orbe musical.",
    stats: { level: 1, hp: 10, maxHp: 10, ac: 14, initiative: 3, speed: "35 pies", proficiency: 2, passivePerception: 15 },
    attributes: { Fuerza: 9, Destreza: 17, Constitucion: 10, Inteligencia: 12, Sabiduria: 16, Carisma: 10 },
    attacks: ["Arco largo +5 - 1d8 + 3 perforante", "Espada corta +5 - 1d6 + 3 perforante"],
    resources: ["Carcaj de Vaelor - ventaja 1 vez por descanso largo; siguiente ataque con desventaja", "Percepcion pasiva - 15"],
    inventory: [
      ["arco-largo", "Arco largo", 1, "Equipo", "1d8 perforante. Municion (alcance 45/180 m). A dos manos, pesado.", "two-hands", 2, 50],
      ["flecha", "Flecha", 20, "Consumible", "Municion para arco largo o corto. 1 PO por 20.", "other", 1, 1],
      ["espada-corta", "Espada corta", 2, "Equipo", "1d6 perforante. Ligera, sutil.", "main-hand", 2, 10],
      ["cuero", "Armadura de cuero", 1, "Equipo", "CA 11 + mod. Destreza. Armadura ligera.", "armor", 10, 10],
      ["carcaj-vaelor", "Carcaj de Vaelor", 1, "Equipo", "Carcaj de cuero oscuro de Vaelor. Homebrew: 1 vez por descanso largo puedes obtener ventaja en un ataque; el siguiente ataque tendra desventaja.", "back", 1, 0],
      ["mochila", "Mochila", 1, "Utilidad", "Capacidad: 30 lb o 0.03 m3.", "other", 5, 2],
      ["petate", "Petate", 1, "Utilidad", "Para dormir. Necesario para descanso largo.", "other", 7, 0.1],
      ["utensilios-cocina", "Utensilios de cocina", 1, "Utilidad", "Olla, platos y cubiertos basicos.", "other", 8, 0.2],
      ["yesquero", "Yesquero", 1, "Utilidad", "Encender fuego en 1 accion.", "other", 1, 0.5],
      ["antorcha", "Antorcha", 10, "Consumible", "Ilumina 6 m de luz brillante y 6 m de tenue. Dura 1 hora.", "other", 1, 0.01],
      ["racion", "Racion de viaje", 10, "Consumible", "Comida seca para un dia de viaje.", "other", 2, 0.5],
      ["odre", "Odre", 1, "Utilidad", "Contenedor de cuero. Capacidad 4 litros.", "other", 5, 0.2],
      ["cuerda-canamo", "Cuerda de canamo", 15, "Consumible", "Aguanta 450 kg. Se gasta con el uso. (15 m)", "other", 10, 1],
      ["libro-edena-ruh", "Libro de los Edena Ruh", 1, "Historia", "Libro con historias, cuentos infantiles y palabras de aliento de la troupe Edena Ruh en su ultima pagina.", "other", 0.5, 0],
      ["cuchillo-pequeno", "Cuchillo pequeno", 1, "Equipo", "1d4 perforante. Objeto de tu trasfondo de huerfano.", "off-hand", 0.5, 1],
      ["mapa-ciudad", "Mapa de la ciudad natal", 1, "Historia", "Mapa con lugares importantes de la ciudad donde creciste con los Edena Ruh.", "other", 0, 0],
      ["raton-mascota", "Raton como mascota", 1, "Historia", "Pequeno companero de tu trasfondo de huerfano. Lo llevas contigo.", "other", 0, 0],
      ["recuerdo-padres", "Recuerdo de tus padres", 1, "Historia", "Un objeto pequeno que conservas de tu familia biologica.", "other", 0.1, 0],
      ["ropa-comun", "Ropa comun", 1, "Equipo", "Vestimenta cotidiana sencilla.", "other", 3, 0.5],
    ],
    currency: { pc: 0, pp: 0, pe: 0, po: 10, ppt: 0 },
    equipped: ["arco-largo", "cuero", "carcaj-vaelor"],
    recommendations: [
      ["Nivel 2: estilo y conjuros", "Tiro con arco aporta +2 a tus ataques a distancia. Marca del cazador agrega dano mientras mantengas concentracion."],
      ["Posicionamiento", "Tu arco funciona mejor lejos del cuerpo a cuerpo. Busca lineas de vision antes de que empiece el combate."],
      ["Carcaj de Vaelor", "Activa la ventaja cuando un impacto importe de verdad y recuerda marcar el siguiente ataque con desventaja."],
    ],
    memories: ["Creciste entre los Edena Ruh: musicos, actores y comerciantes ambulantes que recorrian el continente de feria en feria.", "Vaelor, viejo arquero y jefe de escoltas, te enseno a disparar para sobrevivir: escuchar el bosque, moverte y no perseguir sombras.", "Vaelor te entrego su viejo carcaj de cuero oscuro. Cada corte y remiendo recuerda una noche en que alguien regreso vivo.", "Los Edena Ruh te regalaron un libro de historias con palabras de aliento en su ultima pagina cuando partiste a crear tu propia aventura.", "Tu percepcion te vuelve especialmente valioso frente a trampas.", "Encendiste el orbe musical de la sala 7 y quedaste encantado varias veces hasta que el grupo logro destruirlo.", "Terminas la sesion con agotamiento nivel 1 por el vaiven de carreras causado por el encanto."],
  },
  {
    id: "galahad", name: "Galahad", player: "Rodrigo", initials: "GA", identity: "Guerrero humano - Nivel 1",
    portrait: "portrait-galahad.jpg",
    appearance: "Guerrero humano atletico de cabello negro largo y armadura oscura. Lleva capa roja desgastada, espada de dos manos y marcas encendidas de Belfegor en el brazo.",
    story: "Busca rescatar a su hermana Angel, raptada por el senor demonio Belfegor para drenar su energia.",
    condition: "Agotamiento nivel 1 por caer demasiadas veces bajo el encanto del orbe musical.",
    stats: { level: 1, hp: 12, maxHp: 12, ac: 16, initiative: 2, speed: "30 pies", proficiency: 2, passivePerception: 12 },
    attributes: { Fuerza: 16, Destreza: 14, Constitucion: 15, Inteligencia: 9, Sabiduria: 11, Carisma: 13 },
    attacks: ["Espadon +5 - 2d6 + 3 cortante"],
    resources: ["Tomar aliento - 1d10 + 1 PG por descanso corto o largo", "Estilo propuesto - Combate con armas grandes"],
    inventory: [
      ["espadon", "Espadon", 1, "Equipo", "2d6 cortante. A dos manos, pesada.", "two-hands", 6, 50],
      ["cota-malla", "Cota de malla", 1, "Equipo", "Armadura pesada. CA 16. Requiere Fuerza 13. Desventaja en Sigilo.", "armor", 55, 75],
      ["hacha-mano", "Hacha de mano", 2, "Equipo", "1d6 cortante. Ligera, arrojadiza (alcance 6/18 m).", "main-hand", 2, 5],
      ["tatuaje-belfegor", "Tatuaje de Belfegor", 1, "Historia", "Cicatriz quemada por la sangre de Belfegor en el brazo derecho. Homebrew: 1 vez por descanso corto duplicas movimiento o salto; el siguiente turno tu velocidad se reduce a la mitad.", "body", 0, 0],
      ["mochila", "Mochila", 1, "Utilidad", "Capacidad: 30 lb o 0.03 m3. Paquete de explorador de mazmorras.", "other", 5, 2],
      ["palanca", "Palanca", 1, "Utilidad", "+4 en pruebas de Fuerza para abrir puertas o levantar objetos.", "other", 5, 2],
      ["martillo", "Martillo", 1, "Utilidad", "Clava pitones y realiza reparaciones basicas.", "other", 3, 1],
      ["piton", "Piton", 10, "Consumible", "Clavo de hierro para asegurar cuerda o bloquear puertas.", "other", 0.25, 0.05],
      ["yesquero", "Yesquero", 1, "Utilidad", "Encender fuego en 1 accion.", "other", 1, 0.5],
      ["antorcha", "Antorcha", 10, "Consumible", "Ilumina 6 m de luz brillante y 6 m de tenue. Dura 1 hora.", "other", 1, 0.01],
      ["racion", "Racion de viaje", 10, "Consumible", "Comida seca para un dia de viaje.", "other", 2, 0.5],
      ["odre", "Odre", 1, "Utilidad", "Contenedor de cuero. Capacidad 4 litros.", "other", 5, 0.2],
      ["cuerda-canamo", "Cuerda de canamo", 15, "Consumible", "Aguanta 450 kg. Se gasta con el uso. (15 m)", "other", 10, 1],
    ],
    currency: { pc: 0, pp: 0, pe: 0, po: 0, ppt: 0 },
    equipped: ["espadon", "cota-malla", "tatuaje-belfegor"],
    recommendations: [
      ["Nivel 2: Oleada de accion", "Una vez por descanso corto o largo podras realizar una accion adicional en tu turno. Es flexible y muy potente."],
      ["Espadon", "Combate con armas grandes permite repetir ciertos dados bajos de dano. Tu espada de dos manos ya esta confirmada."],
      ["Supervivencia", "Tomar aliento es una accion adicional: puedes curarte y aun atacar durante el mismo turno."],
    ],
    memories: ["Tras anos de entrenamiento emprendiste la busqueda de tu hermana Angel.", "Belfegor la rapto para drenar su energia, acumular poder y perseguir el dominio absoluto.", "Sabes que el rey enviara asesinos para detenerte. Piensas abrirte paso con fuerza fisica y espada hasta alcanzar tu objetivo.", "La sangre de Belfegor dejo una cicatriz quemada en tu cuerpo que altera brevemente tu movimiento o salto.", "Dejaste inconsciente a Calcryx con el pomo de tu espada, evitando matarla y permitiendo cumplir el trato con Yusdrayl.", "Tuviste la idea de quemar al sacerdote dragon fallido, lo que finalmente impidio que volviera a levantarse.", "Terminas la sesion con agotamiento nivel 1 por el orbe musical."],
  },
  {
    id: "amber", name: "Amber", player: "Cris", initials: "AB", identity: "Guerrera alta elfa - Nivel 1",
    portrait: "portrait-amber.jpg",
    appearance: "Alta elfa pelirroja con una trenza larga, armadura de cuero reforzada y capa azul. Porta la alabarda Tajo; Skully flota cerca envuelta en fuego purpura.",
    story: "Alta elfa criada por enanos, herrera, bebedora de taberna y luchadora alegre. Porta la alabarda Tajo y una calavera reanimada.",
    condition: "Libre tras el trato con Yusdrayl. Trauma severo y acrofobia.",
    stats: { level: 1, hp: 10, maxHp: 10, ac: 14, initiative: 3, speed: "30 pies", proficiency: 2, passivePerception: 12 },
    attributes: { Fuerza: 14, Destreza: 17, Constitucion: 10, Inteligencia: 9, Sabiduria: 10, Carisma: 14 },
    attacks: ["Tajo +4 - 1d10 + 4 cortante", "Arco largo - 1d8 perforante", "Tomahawk +4 - 1d6 + 2 cortante"],
    resources: ["Tomar aliento - 1d10 + 1 PG por descanso corto o largo", "Estilo - Combate con armas grandes", "Estado - liberada por Yusdrayl tras entregar a Calcryx"],
    inventory: [
      ["tajo", "Tajo", 1, "Equipo", "Alabarda personal de Amber. 1d10 cortante. A dos manos, gran alcance, pesada.", "two-hands", 6, 20],
      ["cuero", "Armadura de cuero", 1, "Equipo", "CA 11 + mod. Destreza. Armadura ligera.", "armor", 10, 10],
      ["arco-largo", "Arco largo", 1, "Equipo", "1d8 perforante. Municion (alcance 45/180 m). A dos manos, pesado.", "back", 2, 50],
      ["flecha", "Flecha", 20, "Consumible", "Municion para arco largo o corto. 1 PO por 20.", "other", 1, 1],
      ["espada-larga", "Espada larga", 1, "Equipo", "1d8 cortante. Versatil (1d10 a dos manos).", "main-hand", 3, 15],
      ["calavera-magica", "Skully", 1, "Historia", "Calavera reanimada conservada tras derrotar a un gnomo nigromante. Conserva magia aunque nadie entiende bien que hace.", "belt", 1, 0],
      ["tomahawk-enano", "Tomahawk enano", 2, "Equipo", "Hachas de mano enanas regaladas por su padre Errik. 1d6 cortante. Ligera, arrojadiza (alcance 6/18 m).", "main-hand", 2, 5],
      ["mochila", "Mochila", 1, "Utilidad", "Capacidad: 30 lb o 0.03 m3. Paquete de explorador de mazmorras.", "other", 5, 2],
      ["palanca", "Palanca", 1, "Utilidad", "+4 en pruebas de Fuerza para abrir puertas o levantar objetos.", "other", 5, 2],
      ["martillo", "Martillo", 1, "Utilidad", "Clava pitones y realiza reparaciones basicas.", "other", 3, 1],
      ["piton", "Piton", 10, "Consumible", "Clavo de hierro para asegurar cuerda o bloquear puertas.", "other", 0.25, 0.05],
      ["yesquero", "Yesquero", 1, "Utilidad", "Encender fuego en 1 accion.", "other", 1, 0.5],
      ["antorcha", "Antorcha", 10, "Consumible", "Ilumina 6 m de luz brillante y 6 m de tenue. Dura 1 hora.", "other", 1, 0.01],
      ["racion", "Racion de viaje", 10, "Consumible", "Comida seca para un dia de viaje.", "other", 2, 0.5],
      ["odre", "Odre", 1, "Utilidad", "Contenedor de cuero. Capacidad 4 litros.", "other", 5, 0.2],
      ["cuerda-canamo", "Cuerda de canamo", 15, "Consumible", "Aguanta 450 kg. Se gasta con el uso. (15 m)", "other", 10, 1],
      ["herramientas-herrero", "Herramientas de herrero", 1, "Historia", "Herramientas de artesano para trabajar metal. Las de Amber son enanas, herencia de Regrus.", "other", 8, 20],
      ["carta-gremio", "Carta de presentacion del gremio", 1, "Historia", "Documento de tu trasfondo de artesana gremial. Acredita tu oficio de herrera.", "other", 0, 0],
      ["ropa-viajero", "Ropa de viajero", 1, "Equipo", "Ropa resistente y comoda para el camino.", "other", 4, 2],
    ],
    currency: { pc: 0, pp: 0, pe: 0, po: 15, ppt: 0 },
    equipped: ["tajo", "cuero", "calavera-magica"],
    recommendations: [
      ["Equipo versatil", "Tajo aprovecha Combate con armas grandes. Conserva el arco para situaciones donde acercarte resulte peligroso."],
      ["Nivel 2: Oleada de accion", "Como guerrera obtendras una accion adicional una vez por descanso corto o largo."],
    ],
    memories: ["Errik y Regrus te encontraron cuando eras una bebe elfa cubierta de sangre y te criaron como su hija en un reino enano bajo la montana.", "Regrus te enseno forja y metalurgia. Errik te enseno a luchar con muchas armas, especialmente con tu alabarda Tajo.", "Aunque eres una alta elfa, creciste entre costumbres enanas: hablas comun, enano y orco, disfrutas las tabernas y aceptas desafios de bebida.", "En una aventura derrotaste a un gnomo nigromante lanzandole uno de tus tomahawks. Conservaste como broma una calavera reanimada cuya magia nunca desaparecio.", "Yusdrayl te libero cuando el grupo regreso con Calcryx viva.", "Jot te sorprendio en las salas draconicas antes de escapar invisible y convertido en murcielago.", "La acrofobia es una parte importante de tu personaje."],
  },
];

const retiredItems = {
  arthas: ["espada-larga", "po", "insignia-rango", "trofeo-enemigo", "dados-hueso"],
  "miguel-angel": ["pocion-curacion", "po"],
  nilux: ["po"],
  galahad: ["po"],
  amber: ["po"],
};

let state = loadStateSync();
let activeCharacterId = null;
let toastTimeout;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function loadStateSync() {
  // Load from localStorage synchronously as initial state
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return mergeRemoteState(saved);
  } catch {
    return { characters: clone(initialCharacters), activity: {} };
  }
}
function migrateCondition(characterId, storedCondition, currentCondition) {
  const oldConditions = {
    arthas: ["Cubierto de sangre: -2 Persuasion, +3 Intimidacion."],
    "miguel-angel": ["Mareado: -3 Percepcion. Cubierto de sangre."],
    nilux: ["Sin penalizaciones actuales."],
    galahad: ["Mareado, cubierto de sangre y con olor putrefacto."],
    amber: ["Retenida por Yusdrayl. Trauma severo y acrofobia."],
  };
  if (!storedCondition || (oldConditions[characterId] || []).includes(storedCondition)) return currentCondition;
  return storedCondition;
}
function mergeCurrency(initialCurrency, stored) {
  const currency = { ...EMPTY_CURRENCY, ...initialCurrency, ...stored.currency };
  const legacyGold = (stored.inventory || []).find(([id]) => id === "po");
  if (!stored.currency && legacyGold) currency.po = legacyGold[2];
  return currency;
}
function equipmentSlot(item) { return item[5] || SLOT_BY_ITEM[item[0]] || "other"; }
function itemWeight(item) { return item[6] ?? WEIGHT_BY_ITEM[item[0]] ?? 0; }
function carriedWeight(currentCharacter) {
  const equipmentWeight = currentCharacter.inventory.reduce((total, item) => total + itemWeight(item) * item[2], 0);
  const coinCount = Object.values(currentCharacter.currency || EMPTY_CURRENCY).reduce((total, value) => total + value, 0);
  return equipmentWeight + coinCount / 50;
}
function conflictingSlots(slot) {
  if (slot === "two-hands") return ["two-hands", "main-hand", "off-hand", "shield"];
  if (slot === "main-hand") return ["two-hands", "main-hand"];
  if (slot === "off-hand") return ["two-hands", "off-hand", "shield"];
  if (slot === "shield") return ["two-hands", "off-hand", "shield"];
  if (slot === "other") return [];
  return [slot];
}
function normalizeEquipped(equipped, inventory = []) {
  const normalized = [];
  equipped.forEach((id) => {
    const item = inventory.find(([itemId]) => itemId === id);
    if (!item) return;
    const conflicts = conflictingSlots(equipmentSlot(item));
    const withoutConflicts = normalized.filter((equippedId) => {
      const equippedItem = inventory.find(([itemId]) => itemId === equippedId);
      return !equippedItem || !conflicts.includes(equipmentSlot(equippedItem));
    });
    normalized.length = 0;
    normalized.push(...withoutConflicts, id);
  });
  return [...new Set(normalized)];
}
function mergeInventory(characterId, initialInventory, storedInventory) {
  const storedById = new Map(storedInventory.map((item) => [item[0], item]));
  return [
    ...initialInventory.map((item) => {
      const stored = storedById.get(item[0]);
      return stored ? [item[0], item[1], stored[2], item[3], item[4]] : clone(item);
    }),
    ...storedInventory.filter((item) => !initialInventory.some((initial) => initial[0] === item[0]) && !(retiredItems[characterId] || []).includes(item[0])),
  ];
}
// saveState defined above with Firebase support
function character() { return state.characters.find((item) => item.id === activeCharacterId); }
function escapeHtml(value = "") {
  const element = document.createElement("div");
  element.textContent = String(value);
  return element.innerHTML;
}
function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 2400);
}
function showView(viewId) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  document.querySelector("#back-button").classList.toggle("hidden", viewId === "home-view");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function renderHome() {
  document.querySelector("#session-board").innerHTML = `
    <div class="session-board-header">
      <div>
        <p class="eyebrow">Tablero de sesion</p>
        <h2>Que importa ahora</h2>
      </div>
      <span>Sin spoilers del DM</span>
    </div>
    <div class="session-grid">
      ${campaign.session.map(([label, title, text, tone]) => `
        <article class="session-card ${escapeHtml(tone)}">
          <span>${escapeHtml(label)}</span>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(text)}</p>
        </article>`).join("")}
    </div>`;
  document.querySelector("#current-objectives").innerHTML = campaign.objectives.map(([label, title, text, tone]) => `
    <article class="objective-card ${escapeHtml(tone)}">
      <p class="eyebrow">${escapeHtml(label)}</p>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
    </article>`).join("");
  document.querySelector("#character-grid").innerHTML = state.characters.map((item) => {
    const hpPct = item.stats.maxHp ? Math.min(100, (item.stats.hp / item.stats.maxHp) * 100) : 100;
    const hpLow = hpPct <= 50;
    return `
    <button class="character-card" data-character="${item.id}">
      <img class="portrait" src="${escapeHtml(item.portrait)}" alt="Retrato de ${escapeHtml(item.name)}" />
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.player)} — ${escapeHtml(item.identity)}</p>
      <div class="character-hp-bar"><span style="width:${hpPct}%" class="${hpLow ? 'low' : ''}"></span></div>
    </button>`;
  }).join("");
  document.querySelector("#quest-board").innerHTML = campaign.quests.map(([status, title, text, tone]) => `
    <article class="quest-card ${escapeHtml(tone)}">
      <span class="quest-status">${escapeHtml(status)}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
    </article>`).join("");
  document.querySelector("#known-map").innerHTML = campaign.places.map(([name, status, text, state], index) => `
    <article class="place-card ${escapeHtml(state)}">
      <span class="place-number">${index + 1}</span>
      <div>
        <span class="place-status">${escapeHtml(status)}</span>
        <h3>${escapeHtml(name)}</h3>
        <p>${escapeHtml(text)}</p>
      </div>
    </article>`).join("");
  document.querySelector("#known-lore").innerHTML = campaign.lore.map(([title, source, text]) => `
    <article class="lore-card">
      <span>${escapeHtml(source)}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
    </article>`).join("");
  document.querySelector("#intel-board").innerHTML = campaign.intel.map(([status, title, text, state]) => `
    <article class="intel-card ${escapeHtml(state)}">
      <span>${escapeHtml(status)}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
    </article>`).join("");
  document.querySelector("#campaign-gallery").innerHTML = campaign.gallery.map(([src, title, text]) => `
    <figure class="gallery-card">
      <img src="${escapeHtml(src)}" alt="${escapeHtml(title)}" loading="lazy" />
      <figcaption><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></figcaption>
    </figure>`).join("");
  document.querySelector("#timeline").innerHTML = campaign.timeline.map(([title, text]) => `
    <article class="timeline-entry"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></article>`).join("");
  document.querySelector("#known-npcs").innerHTML = campaign.npcs.map(([name, location, relation, text]) => `
    <article class="story-card npc-story-card">
      <span class="relationship">${escapeHtml(relation)}</span>
      <h3>${escapeHtml(name)}</h3>
      <small>${escapeHtml(location)}</small>
      <p>${escapeHtml(text)}</p>
    </article>`).join("");
  document.querySelector("#campaign-moments").innerHTML = campaign.moments.map(([title, text]) => `
    <article class="moment-card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></article>`).join("");
  const [author, quote] = campaign.quotes[new Date().getDate() % campaign.quotes.length];
  document.querySelector("#campaign-quote").innerHTML = `
    <p class="eyebrow">Una frase para el camino</p>
    <blockquote>${escapeHtml(quote)}</blockquote>
    <cite>${escapeHtml(author)}</cite>`;
  renderLootBoard();
}

function renderLootBoard() {
  // Update home preview
  const preview = document.querySelector("#loot-preview");
  const chestEl = document.querySelector("#chest-contents");
  const summaryEl = document.querySelector("#loot-summary");

  // Aggregate Tesoro items across all characters
  const el = preview || chestEl;
  if (!el) return;
  // Aggregate Tesoro items across all characters
  const lootMap = new Map();
  state.characters.forEach((ch) => {
    (ch.inventory || []).filter(e => e[3] === "Tesoro").forEach((entry) => {
      const [id, name, qty] = entry;
      const value = entry[7] ?? 0;
      const key = name.toLowerCase().trim();
      if (!lootMap.has(key)) lootMap.set(key, { name, qty: 0, value, holders: [] });
      const rec = lootMap.get(key);
      rec.qty += qty;
      rec.value = Math.max(rec.value, value);
      if (qty > 0) rec.holders.push(`${ch.name.split(" ")[0]} x${qty}`);
    });
  });
  const items = [...lootMap.values()].filter(r => r.qty > 0).sort((a, b) => b.qty - a.qty);
  if (!items.length) {
    el.innerHTML = '<p class="helper-copy" style="padding:12px">El grupo no tiene tesoros registrados aun.</p>';
    return;
  }
  const totalValue = items.reduce((s, r) => s + (r.value * r.qty), 0);
  const lootHtml = items.length ? items.map(r => `
    <article class="loot-card">
      <div class="loot-qty">x${r.qty}</div>
      <div>
        <h3>${escapeHtml(r.name)}</h3>
        <p>${r.holders.join(", ")}</p>
        ${r.value > 0 ? `<span class="loot-value">${r.value} PO c/u</span>` : ""}
      </div>
    </article>`).join("") : '<p class="helper-copy" style="padding:8px">Sin tesoros aun.</p>';

  // Home preview: just count
  if (preview) {
    preview.innerHTML = items.length
      ? `<p style="color:var(--muted);font-size:.82rem;margin-top:6px">${items.length} tipo${items.length !== 1 ? "s" : ""} de tesoro · ${items.reduce((s,r)=>s+r.qty,0)} objetos${totalValue > 0 ? ` · ${totalValue} PO estimado` : ""}</p>`
      : '<p style="color:var(--muted);font-size:.82rem;margin-top:6px">El baul esta vacio.</p>';
  }

  // Chest view
  if (chestEl) {
    chestEl.innerHTML = `<div class="loot-grid">${lootHtml}</div>`;
  }
  if (summaryEl && totalValue > 0) {
    summaryEl.innerHTML = `<p class="eyebrow" style="margin-bottom:4px">Valor total estimado</p><p style="color:var(--gold);font-family:Georgia,serif;font-size:1.6rem;font-weight:700">${totalValue} PO</p>`;
  }
}
function parseResources(resources) {
  const parsed = [];
  resources.forEach((text, i) => {
    // Match patterns like:
    // "Sentidos divinos - 4 usos por descanso largo"
    // "Imponer las manos - 5 PG"  (no reset specified, assume largo)
    // "Sacerdote de guerra - 3 ataques adicionales por descanso largo"
    // "Espacios de nivel 1 - 2"
    // "Carcaj de Vaelor - ventaja 1 vez por descanso largo"
    const patterns = [
      // X usos por descanso Y
      /^(.+?)\s*[-–]\s*(\d+)\s+usos?\s+por\s+(descanso\s+\w+)/i,
      // X ataques adicionales por descanso Y
      /^(.+?)\s*[-–]\s*(\d+)\s+ataques?(?:\s+adicionales?)?\s+por\s+(descanso\s+\w+)/i,
      // ventaja X vez por descanso Y
      /^(.+?)\s*[-–]\s*\w+\s+(\d+)\s+vez(?:es)?\s+por\s+(descanso\s+\w+)/i,
      // X PG (sin reset, largo por defecto)
      /^(.+?)\s*[-–]\s*(\d+)\s+PG$/i,
      // Espacios de nivel X - N
      /^(Espacios\s+de\s+nivel\s+\d+)\s*[-–]\s*(\d+)$/i,
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m) {
        const name = m[1].trim();
        const max = parseInt(m[2]);
        const reset = m[3] ? m[3].trim() : 'descanso largo';
        if (max >= 1 && max <= 20) {
          parsed.push({ name, max, reset, originalIdx: i });
          break;
        }
      }
    }
  });
  return parsed;
}
function renderCharacter() {
  const item = character();
  if (!item) return;
  document.querySelector("#profile-hero").innerHTML = `
    <img class="profile-portrait" src="${escapeHtml(item.portrait)}" alt="Retrato de ${escapeHtml(item.name)}" />
    <div>
      <p class="eyebrow">Personaje de ${escapeHtml(item.player)}</p>
      <h1>${escapeHtml(item.name)}</h1>
      <p>${escapeHtml(item.identity)}</p>
      <p>${escapeHtml(item.story)}</p>
      <p class="appearance-copy"><strong>Apariencia:</strong> ${escapeHtml(item.appearance)}</p>
    </div>`;
  const hpPct = item.stats.maxHp ? Math.min(100, (item.stats.hp / item.stats.maxHp) * 100) : 100;
  const hpLow = hpPct <= 50;
  document.querySelector("#summary-stats").innerHTML = [
    ["PG", `${item.stats.hp}/${item.stats.maxHp}`, "hp"],
    ["CA", item.stats.ac, ""], ["Nivel", item.stats.level, ""],
    ["Inic.", item.stats.initiative >= 0 ? `+${item.stats.initiative}` : item.stats.initiative, ""],
    ["Vel.", item.stats.speed, ""], ["Percep.", item.stats.passivePerception, ""],
  ].map(([label, value, type]) => {
    const isHp = type === "hp";
    return `<article class="stat-card${isHp ? ' hp-card' : ''}">
      <strong class="${isHp && hpLow ? 'low' : ''}">${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
      ${isHp ? `<div class="hp-track"><span style="width:${hpPct}%" class="${hpLow ? 'low' : ''}"></span></div>` : ''}
    </article>`;
  }).join("");
  // Rest buttons & resource counters below combat summary
  const restHtml = `
    <div class="rest-buttons">
      <button class="rest-btn short-rest" id="btn-short-rest">⏱ Descanso corto</button>
      <button class="rest-btn" id="btn-long-rest">🌙 Descanso largo</button>
    </div>`;
  const resources = parseResources(item.resources);
  const resourceHtml = resources.length ? `
    <div class="resource-list">
      ${resources.map((r, i) => `
        <div class="resource-row">
          <span class="resource-name">${escapeHtml(r.name)}</span>
          <span class="resource-reset">${escapeHtml(r.reset)}</span>
          <div class="resource-pips">
            ${Array.from({length: r.max}, (_, pi) => {
              const used = (item.resourceUses?.[i] || 0) > pi;
              return `<button class="resource-pip${used ? ' used' : ''}" data-resource-idx="${i}" data-pip-idx="${pi}" title="${used ? 'Marcar disponible' : 'Marcar usado'}"></button>`;
            }).join('')}
          </div>
        </div>`).join('')}
    </div>` : '';
  document.querySelector("#combat-summary").innerHTML = item.attacks.map((text) => `<div class="info-row">${escapeHtml(text)}</div>`).join("") + restHtml + resourceHtml;
  document.querySelector("#current-condition").textContent = item.condition;
  renderSheet();
  renderInventory();
  document.querySelector("#recommendation-list").innerHTML = item.recommendations.map(([title, text]) => `
    <article class="recommendation"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></article>`).join("");
  document.querySelector("#memory-list").innerHTML = item.memories.map((text) => `<div class="info-row">${escapeHtml(text)}</div>`).join("");
}
function renderSheet() {
  const item = character();
  const attributeFields = Object.entries(item.attributes).map(([name, value]) => `
    <label>${escapeHtml(name)}<input data-attribute="${escapeHtml(name)}" type="number" value="${escapeHtml(value)}" /></label>`).join("");
  document.querySelector("#sheet-form").innerHTML = `
    <label>Nivel<input data-stat="level" type="number" min="1" value="${escapeHtml(item.stats.level)}" /></label>
    <label>PG actuales<input data-stat="hp" type="number" min="0" value="${escapeHtml(item.stats.hp)}" /></label>
    <label>PG maximos<input data-stat="maxHp" type="number" min="0" value="${escapeHtml(item.stats.maxHp)}" /></label>
    <label>CA<input data-stat="ac" type="number" min="0" value="${escapeHtml(item.stats.ac)}" /></label>
    <label>Iniciativa<input data-stat="initiative" type="number" value="${escapeHtml(item.stats.initiative)}" /></label>
    <label>Velocidad<input data-stat="speed" value="${escapeHtml(item.stats.speed)}" /></label>
    <label>Percepcion pasiva<input data-stat="passivePerception" type="number" value="${escapeHtml(item.stats.passivePerception)}" /></label>
    ${attributeFields}
    <label class="wide-field">Estado actual<textarea id="sheet-condition">${escapeHtml(item.condition)}</textarea></label>`;
}
function renderItemCard(entry, equipped, showEquip) {
  const [id, name, quantity, itemCategory, description] = entry;
  const valueField = entry[7] ?? 0;
  const descConverted = piesAMetros(description);
  const isConsumable = itemCategory === "Consumible";
  const isEquip = itemCategory === "Equipo";
  const isRope = /cuerda|soga/i.test(name);
  const primaryAction = isEquip
    ? `<button class="small-button gold-button" data-equip-item="${id}">${equipped ? "Quitar" : "Equipar"}</button>`
    : isConsumable
      ? `<div class="use-controls">
           <button class="small-button gold-button" data-use-item="${id}" ${quantity < 1 ? "disabled" : ""}>Usar</button>
           <input class="use-amount-input" type="number" min="1" max="${quantity}" value="1" data-use-amount-for="${id}" />
         </div>`
      : "";
  const valueHtml = valueField > 0
    ? `<span class="item-value-tag">${valueField} PO</span>`
    : "";
  return `
    <article class="inventory-item">
      <div>
        <h3>${escapeHtml(name)} <span class="quantity">x${quantity}</span>${equipped ? ' <span class="equipped-badge">Equipado</span>' : ""}</h3>
        <p>${isEquip ? `${escapeHtml(SLOT_LABELS[equipmentSlot(entry)])} · ` : ""}${escapeHtml(descConverted)}</p>
        ${valueHtml}
      </div>
      <div class="item-actions">
        ${primaryAction}
        ${isRope ? `<button class="small-button" data-rope-item="${id}">~ m</button>` : ''}
        <button class="small-button" data-add-one-item="${id}">+1</button>
        <button class="small-button" data-edit-item="${id}">✎</button>
        <button class="small-button danger-button" data-drop-item="${id}">Tirar</button>
      </div>
    </article>`;
}

function renderInventory() {
  const item = character();
  item.equipped ||= [];
  item.currency ||= { ...EMPTY_CURRENCY };

  // Currency
  document.querySelector("#currency-grid").innerHTML = Object.entries(CURRENCY_LABELS).map(([key, label]) => `
    <article class="currency-item">
      <span>${label}</span>
      <div>
        <button class="currency-button" data-currency="${key}" data-currency-delta="-1" type="button">-</button>
        <strong>${item.currency[key] || 0}</strong>
        <button class="currency-button" data-currency="${key}" data-currency-delta="1" type="button">+</button>
      </div>
    </article>`).join("");

  // Carry weight
  const weight = carriedWeight(item);
  const capacity = (item.attributes.Fuerza || 0) * 15;
  const weightPercent = capacity ? Math.min(100, weight / capacity * 100) : 0;
  document.querySelector("#carry-card").innerHTML = `
    <div class="carry-heading">
      <span>Carga transportada</span>
      <strong>${weight.toFixed(1)} / ${capacity} lb</strong>
    </div>
    <div class="carry-track"><span style="width: ${weightPercent}%"></span></div>
    <p>${weight > capacity ? "Estas superando tu capacidad de carga." : "Capacidad maxima: Fuerza x 15 lb. Cada 50 monedas pesan 1 lb."}</p>`;

  // ── Tab: En uso (Equipo equipped + Consumibles + Tesoro) ──
  const activoItems = item.inventory.filter(e => ACTIVO_CATEGORIES.includes(e[3]));
  const activoOrder = ["Equipo", "Consumible", "Tesoro"];
  const activoSections = activoOrder.map((cat) => {
    const catItems = activoItems.filter(e => e[3] === cat);
    if (!catItems.length) return "";
    return `<section class="inventory-section">
      <h3 class="inventory-section-title">${escapeHtml(cat)}</h3>
      ${catItems.map(e => renderItemCard(e, item.equipped.includes(e[0]), true)).join("")}
    </section>`;
  }).join("");

  // ── Tab: Mochila (Utilidad + Historia) ──
  const mochilaItems = item.inventory.filter(e => MOCHILA_CATEGORIES.includes(e[3]));
  const mochilaOrder = ["Historia", "Utilidad"];
  const mochilaSections = mochilaOrder.map((cat) => {
    const catItems = mochilaItems.filter(e => e[3] === cat);
    if (!catItems.length) return "";
    const catLabel = cat === "Historia" ? "Objetos personales" : "Utilidades";
    return `<section class="inventory-section">
      <h3 class="inventory-section-title">${catLabel}</h3>
      ${catItems.map(e => renderItemCard(e, false, false)).join("")}
    </section>`;
  }).join("");

  // Render with sub-tabs
  document.querySelector("#inventory-list").innerHTML = `
    <div class="inv-tabs">
      <button class="inv-tab active" data-inv-tab="activo">En uso</button>
      <button class="inv-tab" data-inv-tab="mochila">Mochila</button>
    </div>
    <div class="inv-panel active" id="inv-activo">${activoSections || '<p class="helper-copy">Sin objetos activos.</p>'}</div>
    <div class="inv-panel" id="inv-mochila">${mochilaSections || '<p class="helper-copy">La mochila esta vacia.</p>'}</div>`;

  const activity = state.activity[item.id] || [];
  document.querySelector("#activity-list").innerHTML = activity.map((entry) => `<p class="activity-entry">${escapeHtml(entry)}</p>`).join("") || '<p class="helper-copy">Todavia no hay movimientos.</p>';
}
function addActivity(message) {
  state.activity[activeCharacterId] ||= [];
  state.activity[activeCharacterId].unshift(message);
  state.activity[activeCharacterId] = state.activity[activeCharacterId].slice(0, 8);
}
function activateCharacter(id) {
  activeCharacterId = id;
  document.querySelectorAll(".profile-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === "summary-panel"));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === "summary-panel"));
  renderCharacter();
  showView("character-view");
}

document.addEventListener("click", (event) => {
  const characterButton = event.target.closest("[data-character]");
  if (characterButton) activateCharacter(characterButton.dataset.character);
  const goButton = event.target.closest("[data-go]");
  if (goButton) showView(goButton.dataset.go);
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    document.querySelectorAll(".profile-tab").forEach((button) => button.classList.toggle("active", button === tab));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === tab.dataset.tab));
  }
  // Inventory sub-tabs
  const invTab = event.target.closest("[data-inv-tab]");
  if (invTab) {
    document.querySelectorAll(".inv-tab").forEach(b => b.classList.toggle("active", b === invTab));
    document.querySelectorAll(".inv-panel").forEach(p => p.classList.toggle("active", p.id === `inv-${invTab.dataset.invTab}`));
  }
  const useButton = event.target.closest("[data-use-item]");
  if (useButton) {
    const itemId = useButton.dataset.useItem;
    const inv = character().inventory.find(([id]) => id === itemId);
    if (!inv || inv[2] < 1) return;
    // Check if there's an amount input
    const amountInput = document.querySelector(`[data-use-amount-for="${itemId}"]`);
    const amount = amountInput ? Math.min(parseInt(amountInput.value) || 1, inv[2]) : 1;
    inv[2] = Math.max(0, inv[2] - amount);
    addActivity(`Usaste ${inv[1]} x${amount}. Quedan ${inv[2]}.`);
    saveState(); renderInventory(); showToast(`${inv[1]} x${amount} usado.`);
  }
  const equipButton = event.target.closest("[data-equip-item]");
  if (equipButton) {
    const currentCharacter = character();
    const item = currentCharacter.inventory.find(([id]) => id === equipButton.dataset.equipItem);
    if (!item) return;
    currentCharacter.equipped ||= [];
    const equipped = currentCharacter.equipped.includes(item[0]);
    if (equipped) {
      currentCharacter.equipped = currentCharacter.equipped.filter((id) => id !== item[0]);
    } else {
      const conflicts = conflictingSlots(equipmentSlot(item));
      currentCharacter.equipped = currentCharacter.equipped.filter((id) => {
        const equippedItem = currentCharacter.inventory.find(([itemId]) => itemId === id);
        return !equippedItem || !conflicts.includes(equipmentSlot(equippedItem));
      });
      currentCharacter.equipped.push(item[0]);
    }
    addActivity(`${equipped ? "Quitaste" : "Equipaste"} ${item[1]}.`);
    saveState(); renderInventory(); showToast(`${item[1]} ${equipped ? "guardado" : "equipado"}.`);
  }
  const addOneButton = event.target.closest("[data-add-one-item]");
  if (addOneButton) {
    const item = character().inventory.find(([id]) => id === addOneButton.dataset.addOneItem);
    if (!item) return;
    item[2] += 1;
    addActivity(`Agregaste ${item[1]} x1. Ahora tienes ${item[2]}.`);
    saveState(); renderInventory(); showToast(`${item[1]} +1.`);
  }
  const currencyButton = event.target.closest("[data-currency]");
  if (currencyButton) {
    const currentCharacter = character();
    const key = currencyButton.dataset.currency;
    const delta = Number(currencyButton.dataset.currencyDelta);
    currentCharacter.currency ||= { ...EMPTY_CURRENCY };
    currentCharacter.currency[key] = Math.max(0, (currentCharacter.currency[key] || 0) + delta);
    saveState(); renderInventory();
  }
  const dropButton = event.target.closest("[data-drop-item]");
  if (dropButton) {
    const inv = character().inventory.find(([id]) => id === dropButton.dataset.dropItem);
    if (!inv) return;
    const dlg = document.querySelector("#drop-dialog");
    dlg._dropId = dropButton.dataset.dropItem;
    document.querySelector("#drop-dialog-title").textContent = `Tirar: ${inv[1]}`;
    document.querySelector("#drop-current-qty").textContent = `Cantidad actual: ${inv[2]}`;
    document.querySelector("#drop-amount").value = inv[2];
    document.querySelector("#drop-amount").max = inv[2];
    dlg.showModal();
  }
  const editButton = event.target.closest("[data-edit-item]");
  if (editButton) openItemDialog(editButton.dataset.editItem);

  const ropeButton = event.target.closest("[data-rope-item]");
  if (ropeButton) {
    const inv = character().inventory.find(([id]) => id === ropeButton.dataset.ropeItem);
    if (!inv) return;
    const dlg = document.querySelector("#rope-dialog");
    document.querySelector("#rope-dialog-title").textContent = inv[1];
    document.querySelector("#rope-current-label").textContent = `Cantidad actual: ${inv[2]} m`;
    dlg._ropeId = ropeButton.dataset.ropeItem;
    dlg.showModal();
  }
});
document.querySelector("#back-button").addEventListener("click", () => showView("home-view"));
document.querySelector("#save-sheet").addEventListener("click", () => {
  const item = character();
  document.querySelectorAll("[data-stat]").forEach((input) => {
    item.stats[input.dataset.stat] = input.type === "number" ? Number(input.value) : input.value;
  });
  document.querySelectorAll("[data-attribute]").forEach((input) => { item.attributes[input.dataset.attribute] = Number(input.value); });
  item.condition = document.querySelector("#sheet-condition").value;
  addActivity("Actualizaste la ficha del personaje.");
  saveState(); renderCharacter(); showToast("Ficha guardada.");
});
function openItemDialog(editId = null) {
  const dlg = document.querySelector("#item-dialog");
  const title = document.querySelector("#item-dialog-title");
  const submitBtn = document.querySelector("#item-submit-btn");
  document.querySelector("#item-edit-id").value = editId || "";
  document.querySelector("#item-search-wrap").classList.toggle("hidden", !!editId);
  if (editId) {
    const inv = character().inventory.find(([id]) => id === editId);
    if (!inv) return;
    title.textContent = "Editar objeto";
    submitBtn.textContent = "Guardar cambios";
    document.querySelector("#item-name").value = inv[1];
    document.querySelector("#item-quantity").value = inv[2];
    document.querySelector("#item-category").value = inv[3];
    document.querySelector("#item-description").value = inv[4] || "";
    document.querySelector("#item-weight").value = inv[6] ?? 0;
    document.querySelector("#item-value").value = inv[7] ?? 0;
    document.querySelector("#item-slot").value = inv[5] || "other";
    document.querySelector("#item-slot-field").classList.toggle("hidden", inv[3] !== "Equipo");
  } else {
    title.textContent = "Agregar objeto";
    submitBtn.textContent = "Agregar";
    document.querySelector("#item-form").reset();
    document.querySelector("#item-slot-field").classList.add("hidden");
    document.querySelector("#item-search-results").classList.add("hidden");
    document.querySelector("#item-search-results").innerHTML = "";
    document.querySelector("#item-search").value = "";
  }
  dlg.showModal();
}

document.querySelector("#open-add-item").addEventListener("click", () => openItemDialog());
document.querySelector("#cancel-item").addEventListener("click", () => document.querySelector("#item-dialog").close());
document.querySelector("#item-category").addEventListener("change", (event) => {
  document.querySelector("#item-slot-field").classList.toggle("hidden", event.target.value !== "Equipo");
});

document.querySelector("#item-search").addEventListener("input", (event) => {
  const q = event.target.value.trim().toLowerCase();
  const results = document.querySelector("#item-search-results");
  if (q.length < 2) { results.classList.add("hidden"); results.innerHTML = ""; return; }
  const matches = ITEM_DATABASE.filter(([id, name, cat, w, v, desc, src]) =>
    name.toLowerCase().includes(q) || desc.toLowerCase().includes(q)
  ).slice(0, 8);
  if (!matches.length) { results.classList.add("hidden"); return; }
  results.classList.remove("hidden");
  results.innerHTML = matches.map(([id, name, cat, weight, value, desc, src]) => `
    <button type="button" class="search-result-item" data-db-id="${escapeHtml(id)}">
      <span class="search-result-name">${escapeHtml(name)}</span>
      <span class="search-result-meta">${escapeHtml(cat)} · ${weight} lb${value ? ` · ${value} PO` : ""} <em>${escapeHtml(src)}</em></span>
      <span class="search-result-desc">${escapeHtml(desc)}</span>
    </button>`).join("");
});

document.querySelector("#item-search-results").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-db-id]");
  if (!btn) return;
  const found = ITEM_DATABASE.find(([i]) => i === btn.dataset.dbId);
  if (!found) return;
  const [id, name, cat, weight, value, desc] = found;
  document.querySelector("#item-name").value = name;
  document.querySelector("#item-category").value = cat;
  document.querySelector("#item-weight").value = weight;
  document.querySelector("#item-value").value = value;
  document.querySelector("#item-description").value = desc;
  document.querySelector("#item-slot-field").classList.toggle("hidden", cat !== "Equipo");
  document.querySelector("#item-search-results").classList.add("hidden");
  document.querySelector("#item-search").value = "";
});
// Short rest handler
document.addEventListener("click", (event) => {
  const shortRest = event.target.closest("#btn-short-rest");
  if (shortRest) {
    const item = character();
    if (!item) return;
    // Roll hit die (d10 Fighter, d8 Cleric/Paladin, d6 Ranger)
    const hitDice = { arthas: 10, "miguel-angel": 8, nilux: 10, galahad: 10, amber: 10 };
    const die = hitDice[item.id] || 8;
    const roll = Math.ceil(Math.random() * die);
    const conMod = Math.floor(((item.attributes.Constitucion || 10) - 10) / 2);
    const healed = Math.max(1, roll + conMod);
    const oldHp = item.stats.hp;
    item.stats.hp = Math.min(item.stats.maxHp, item.stats.hp + healed);
    // Reset short-rest resources
    if (!item.resourceUses) item.resourceUses = {};
    const resources = parseResources(item.resources);
    resources.forEach((r, i) => {
      if (r.reset.toLowerCase().includes('corto') || r.reset.toLowerCase().includes('largo')) {
        item.resourceUses[i] = 0;
      }
    });
    addActivity(`Descanso corto: recuperaste ${item.stats.hp - oldHp} PG (d${die}+${conMod}).`);
    saveState(); renderCharacter(); showToast(`Descanso corto: +${item.stats.hp - oldHp} PG`);
  }
  const longRest = event.target.closest("#btn-long-rest");
  if (longRest) {
    const item = character();
    if (!item) return;
    item.stats.hp = item.stats.maxHp;
    item.resourceUses = {};
    addActivity("Descanso largo: PG restaurados al maximo y recursos recuperados.");
    saveState(); renderCharacter(); showToast("Descanso largo completado.");
  }
  const pip = event.target.closest("[data-resource-idx]");
  if (pip && !pip.closest("[data-use-item]") && !pip.closest("[data-equip-item]")) {
    const item = character();
    if (!item) return;
    const rIdx = parseInt(pip.dataset.resourceIdx);
    const pIdx = parseInt(pip.dataset.pipIdx);
    item.resourceUses ||= {};
    const currentUsed = item.resourceUses[rIdx] || 0;
    // Toggle: if clicking on the last used pip, unmark it; else mark up to this pip
    item.resourceUses[rIdx] = currentUsed > pIdx ? pIdx : pIdx + 1;
    saveState(); renderCharacter();
  }
});

document.querySelector("#item-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = document.querySelector("#item-name").value.trim();
  if (!name) return;
  const quantity = Number(document.querySelector("#item-quantity").value);
  const category = document.querySelector("#item-category").value;
  const slot = category === "Equipo" ? document.querySelector("#item-slot").value : "";
  const weight = Number(document.querySelector("#item-weight").value) || 0;
  const value = Number(document.querySelector("#item-value").value) || 0;
  const description = document.querySelector("#item-description").value.trim() || "Sin descripcion.";
  const editId = document.querySelector("#item-edit-id").value;
  if (editId) {
    const inv = character().inventory.find(([id]) => id === editId);
    if (inv) {
      inv[1] = name; inv[2] = quantity; inv[3] = category;
      inv[4] = description; inv[5] = slot; inv[6] = weight; inv[7] = value;
      addActivity(`Editaste ${name}.`);
      saveState(); renderInventory(); showToast(`${name} actualizado.`);
    }
  } else {
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    character().inventory.push([id, name, quantity, category, description, slot, weight, value]);
    addActivity(`Agregaste ${name} x${quantity}.`);
    saveState(); renderInventory(); showToast(`${name} agregado.`);
  }
  document.querySelector("#item-slot-field").classList.add("hidden");
  document.querySelector("#item-dialog").close();
});

// Rope dialog handlers
document.querySelector("#rope-cancel").addEventListener("click", () => document.querySelector("#rope-dialog").close());

// Drop dialog handlers
document.querySelector("#drop-cancel").addEventListener("click", () => document.querySelector("#drop-dialog").close());
document.querySelector("#drop-confirm").addEventListener("click", () => {
  const dlg = document.querySelector("#drop-dialog");
  const dropAll = document.querySelector("#drop-all-check").checked;
  const amount = dropAll ? null : (parseInt(document.querySelector("#drop-amount").value) || 1);
  const inv = character().inventory.find(([id]) => id === dlg._dropId);
  if (!inv) { dlg.close(); return; }
  if (dropAll || amount >= inv[2]) {
    character().inventory = character().inventory.filter(([id]) => id !== dlg._dropId);
    character().equipped = (character().equipped || []).filter((id) => id !== dlg._dropId);
    addActivity(`Tiraste ${inv[1]} (todo).`);
    saveState(); renderInventory(); showToast(`${inv[1]} eliminado.`);
  } else {
    inv[2] = Math.max(0, inv[2] - amount);
    addActivity(`Tiraste ${inv[1]} x${amount}. Quedan ${inv[2]}.`);
    saveState(); renderInventory(); showToast(`${inv[1]} x${amount} tirado.`);
  }
  dlg.close();
});
document.querySelector("#drop-all-check").addEventListener("change", (e) => {
  document.querySelector("#drop-amount").disabled = e.target.checked;
});
document.querySelector("#rope-minus").addEventListener("click", () => {
  const dlg = document.querySelector("#rope-dialog");
  const inv = character().inventory.find(([id]) => id === dlg._ropeId);
  if (!inv) return;
  const amount = Number(document.querySelector("#rope-amount").value) || 1;
  inv[2] = Math.max(0, inv[2] - amount);
  document.querySelector("#rope-current-label").textContent = `Cantidad actual: ${inv[2]} m`;
  addActivity(`Usaste ${amount} m de ${inv[1]}. Quedan ${inv[2]} m.`);
  saveState(); renderInventory(); showToast(`${amount} m usados.`);
});
document.querySelector("#rope-plus").addEventListener("click", () => {
  const dlg = document.querySelector("#rope-dialog");
  const inv = character().inventory.find(([id]) => id === dlg._ropeId);
  if (!inv) return;
  const amount = Number(document.querySelector("#rope-amount").value) || 1;
  inv[2] += amount;
  document.querySelector("#rope-current-label").textContent = `Cantidad actual: ${inv[2]} m`;
  addActivity(`Agregaste ${amount} m a ${inv[1]}. Total: ${inv[2]} m.`);
  saveState(); renderInventory(); showToast(`+${amount} m.`);
});

// Initial render from localStorage, then update from Firestore
renderHome();

(async () => {
  const remote = await loadStateFromFirestore();
  if (remote) {
    state = mergeRemoteState(remote);
    renderHome();
  }
  firestoreReady = true;
  subscribeToChanges();
})();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
