// Comprimeix el GLB del món per a la web: `node compress-world.mjs <entrada.glb> <sortida.glb.gz>`.
//
// `gltfpack` no serveix: es menja els atributs propis (`_tone`, `_bank`, `_HOUSE`). I la quantització
// de `KHR_mesh_quantization` posaria transformacions als nodes, mentre que el joc llegeix les malles
// directament en coordenades del món. Aquí els atributs continuen sent Float32 en memòria: només es
// redueix la precisió de cara a Meshopt (EXT_meshopt_compression, còdec v0: el que llegeix el
// decodificador de Three), i el conjunt es passa per gzip, perquè GitHub serveix el fitxer tal qual.
import fs from "node:fs";
import zlib from "node:zlib";
import { MeshoptEncoder } from "meshoptimizer/encoder";

const USAGE = "Ús: node compress-world.mjs <entrada.glb> <sortida.glb.gz>";

// Bits de la part fraccionària de cada atribut. El pas és 2^-bits a tot el món: dos trossos que es
// toquen arrodoneixen igual el vèrtex de la vora, i no s'obren esquerdes.
const FRACTION_BITS = {
  POSITION: 10, // ~1 mm
  NORMAL: 9, // ~0,1°
  _tone: 8,
  _bank: 8,
  _HOUSE: 0, // identificador enter
};

const GL_UBYTE = 5121;
const GL_USHORT = 5123;
const GL_UINT = 5125;
const GL_FLOAT = 5126;
const GL_ARRAY_BUFFER = 34962;
const GL_ELEMENT_ARRAY_BUFFER = 34963;
const GL_TRIANGLES = 4;
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const ARRAY_TYPES = { [GL_UBYTE]: Uint8Array, [GL_USHORT]: Uint16Array, [GL_UINT]: Uint32Array, [GL_FLOAT]: Float32Array };
const MANTISSA_LIMIT = 2 ** 23;

function readGlb(file) {
  const raw = fs.readFileSync(file);
  if (raw.toString("latin1", 0, 4) !== "glTF") {
    throw new Error(`${file} no és un GLB`);
  }
  const jsonLength = raw.readUInt32LE(12);
  const gltf = JSON.parse(raw.toString("utf8", 20, 20 + jsonLength));
  return { gltf, bin: raw.subarray(20 + jsonLength + 8) };
}

function writeGlb(gltf, body) {
  const json = Buffer.from(JSON.stringify(gltf));
  const paddedJson = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "latin1");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + paddedJson.length + 8 + body.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(paddedJson.length, 0);
  jsonHeader.write("JSON", 4, "latin1");
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(body.length, 0);
  binHeader.write("BIN\0", 4, "latin1");
  return Buffer.concat([header, jsonHeader, paddedJson, binHeader, body]);
}

/**
 * Format del filtre EXPONENTIAL de Meshopt: 24 bits de mantissa i 8 d'exponent. Amb l'exponent fix,
 * el byte alt no canvia mai i el còdec se l'estalvia gairebé sencer.
 */
function toExponentialStream(values, bits, label) {
  const scale = 2 ** bits;
  const exponent = (-bits & 0xff) << 24;
  const out = new Uint32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const mantissa = Math.round(values[i] * scale);
    if (!(Math.abs(mantissa) < MANTISSA_LIMIT)) {
      throw new Error(`${label}: el valor ${values[i]} no hi cap amb ${bits} bits de fracció`);
    }
    out[i] = (exponent | (mantissa & 0xffffff)) >>> 0;
  }
  return new Uint8Array(out.buffer);
}

function compressGlb({ gltf, bin }) {
  const sourceAccessors = gltf.accessors;
  const sourceViews = gltf.bufferViews;
  const accessors = [];
  const bufferViews = [];
  const chunks = [];
  let compressedBytes = 0;
  let decodedBytes = 0;

  const readAccessor = (accessor) => {
    const view = sourceViews[accessor.bufferView];
    const ArrayType = ARRAY_TYPES[accessor.componentType];
    if (!ArrayType || (view.byteStride && view.byteStride !== COMPONENTS[accessor.type] * ArrayType.BYTES_PER_ELEMENT)) {
      throw new Error(`Accessor no suportat: ${JSON.stringify(accessor)}`);
    }
    const start = bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const length = accessor.count * COMPONENTS[accessor.type];
    return new ArrayType(bin.buffer.slice(start, start + length * ArrayType.BYTES_PER_ELEMENT));
  };

  const addView = (data, count, stride, mode, filter, target) => {
    const encoded = MeshoptEncoder.encodeGltfBuffer(data, count, stride, mode, 0);
    const extension = { buffer: 0, byteOffset: compressedBytes, byteLength: encoded.length, byteStride: stride, mode, count };
    if (filter) {
      extension.filter = filter;
    }
    const padding = (4 - (encoded.length % 4)) % 4;
    chunks.push(Buffer.from(encoded), Buffer.alloc(padding));
    compressedBytes += encoded.length + padding;
    const view = {
      buffer: 1,
      byteOffset: decodedBytes,
      byteLength: count * stride,
      target,
      extensions: { EXT_meshopt_compression: extension },
    };
    if (mode === "ATTRIBUTES") {
      view.byteStride = stride;
    }
    decodedBytes += count * stride;
    bufferViews.push(view);
    return bufferViews.length - 1;
  };

  // Els 256 trossos de terreny comparteixen índex: es reordenen igual i el continuen compartint.
  const orderedIndices = new Map();

  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      if (primitive.indices === undefined || (primitive.mode ?? GL_TRIANGLES) !== GL_TRIANGLES) {
        throw new Error(`${mesh.name}: només es comprimeixen triangles indexats`);
      }
      const vertexCount = sourceAccessors[primitive.attributes.POSITION].count;
      const key = `${primitive.indices}:${vertexCount}`;
      let order = orderedIndices.get(key);
      if (!order) {
        const indices = new Uint32Array(readAccessor(sourceAccessors[primitive.indices]));
        const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, false);
        const narrow = unique <= 0xffff ? new Uint16Array(indices) : indices;
        const view = addView(
          new Uint8Array(narrow.buffer),
          narrow.length,
          narrow.BYTES_PER_ELEMENT,
          "TRIANGLES",
          undefined,
          GL_ELEMENT_ARRAY_BUFFER,
        );
        accessors.push({
          bufferView: view,
          componentType: narrow.BYTES_PER_ELEMENT === 2 ? GL_USHORT : GL_UINT,
          count: narrow.length,
          type: "SCALAR",
        });
        order = { remap, unique, accessor: accessors.length - 1 };
        orderedIndices.set(key, order);
      }
      primitive.indices = order.accessor;

      for (const [name, accessorId] of Object.entries(primitive.attributes)) {
        const source = sourceAccessors[accessorId];
        const size = COMPONENTS[source.type];
        const values = readAccessor(source);
        const reordered = new values.constructor(order.unique * size);
        for (let vertex = 0; vertex < vertexCount; vertex++) {
          const target = order.remap[vertex];
          if (target === 0xffffffff) {
            continue; // vèrtex que cap triangle no fa servir
          }
          for (let c = 0; c < size; c++) {
            reordered[target * size + c] = values[vertex * size + c];
          }
        }
        const accessor = { componentType: source.componentType, count: order.unique, type: source.type };
        if (source.normalized) {
          accessor.normalized = true;
        }
        if (source.componentType === GL_FLOAT) {
          const bits = FRACTION_BITS[name];
          if (bits === undefined) {
            throw new Error(`${mesh.name}: atribut sense precisió definida: ${name}`);
          }
          accessor.bufferView = addView(toExponentialStream(reordered, bits, name), order.unique, size * 4, "ATTRIBUTES", "EXPONENTIAL", GL_ARRAY_BUFFER);
        } else {
          const stride = size * reordered.BYTES_PER_ELEMENT;
          if (stride % 4 !== 0) {
            throw new Error(`${mesh.name}: ${name} té un pas de ${stride} bytes`);
          }
          accessor.bufferView = addView(new Uint8Array(reordered.buffer), order.unique, stride, "ATTRIBUTES", undefined, GL_ARRAY_BUFFER);
        }
        if (name === "POSITION") {
          // Glb: min/max són obligatoris i han de quadrar amb els valors ja arrodonits.
          const scale = 2 ** FRACTION_BITS.POSITION;
          accessor.min = [Infinity, Infinity, Infinity];
          accessor.max = [-Infinity, -Infinity, -Infinity];
          for (let i = 0; i < reordered.length; i++) {
            const c = i % 3;
            const value = Math.round(reordered[i] * scale) / scale;
            accessor.min[c] = Math.min(accessor.min[c], value);
            accessor.max[c] = Math.max(accessor.max[c], value);
          }
        }
        accessors.push(accessor);
        primitive.attributes[name] = accessors.length - 1;
      }
    }
  }

  gltf.accessors = accessors;
  gltf.bufferViews = bufferViews;
  gltf.buffers = [
    { byteLength: compressedBytes },
    { byteLength: decodedBytes, extensions: { EXT_meshopt_compression: { fallback: true } } },
  ];
  gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed ?? []), "EXT_meshopt_compression"])];
  gltf.extensionsRequired = [...new Set([...(gltf.extensionsRequired ?? []), "EXT_meshopt_compression"])];
  return writeGlb(gltf, Buffer.concat(chunks));
}

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  throw new Error(USAGE);
}
await MeshoptEncoder.ready;
const glb = compressGlb(readGlb(input));
const gzipped = zlib.gzipSync(glb, { level: 9 });
fs.writeFileSync(output, gzipped);
const mb = (bytes) => (bytes / 1e6).toFixed(1);
console.log(`Món comprimit: ${mb(fs.statSync(input).size)} MB → ${mb(glb.length)} MB (Meshopt) → ${mb(gzipped.length)} MB (gzip): ${output}`);
