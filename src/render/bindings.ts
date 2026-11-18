import * as THREE from 'three';
import type { Entity } from '../ecs/Entity';
import type { BindingSpec } from './Binding';
import { IGNORE_TRANSFORM } from './Binding';
import { isGeometryDesc, isMaterialDesc, type RenderResources } from './descriptors';
import {
  Camera,
  Light,
  MeshRenderer,
  SceneObject,
  type CameraData,
  type LightData,
  type MeshRendererData,
  type SceneObjectData,
} from './components';

// ───────── 網格 ─────────

/** 每個網格目前用的描述（換了描述才重新取得，平常每幀只比對參考） */
interface MeshSlot {
  geometrySource: unknown;
  geometryKey: string | null;
  materialSource: unknown;
  materialKey: string | null;
}

/** 網格：幾何、材質可以是 three.js 物件或描述（描述由 resources 建立與共用） */
export function createMeshSpec(resources: RenderResources): BindingSpec<MeshRendererData, THREE.Mesh> {
  const slots = new WeakMap<THREE.Mesh, MeshSlot>();
  const slotOf = (mesh: THREE.Mesh) => {
    let slot = slots.get(mesh);
    if (!slot)
      slots.set(
        mesh,
        (slot = { geometrySource: undefined, geometryKey: null, materialSource: undefined, materialKey: null }),
      );
    return slot;
  };
  return {
    type: MeshRenderer,
    create: () => new THREE.Mesh(),
    update(mesh, d) {
      const slot = slotOf(mesh);
      if (d.geometry !== slot.geometrySource) {
        if (slot.geometryKey) resources.release(slot.geometryKey);
        slot.geometrySource = d.geometry;
        slot.geometryKey = null;
        if (d.geometry === null) mesh.geometry = EMPTY_GEOMETRY;
        else if (isGeometryDesc(d.geometry)) {
          const r = resources.acquireGeometry(d.geometry);
          slot.geometryKey = r.key;
          mesh.geometry = r.value;
        } else mesh.geometry = d.geometry;
      }
      if (d.material !== slot.materialSource) {
        if (slot.materialKey) resources.release(slot.materialKey);
        slot.materialSource = d.material;
        slot.materialKey = null;
        if (d.material === null) mesh.material = EMPTY_MATERIAL;
        else if (isMaterialDesc(d.material)) {
          const r = resources.acquireMaterial(d.material);
          slot.materialKey = r.key;
          mesh.material = r.value;
        } else mesh.material = d.material as THREE.Material | THREE.Material[];
      }
      // 幾何、材質為 null 時給空的，避免繪製報錯
      mesh.visible = d.visible && d.geometry !== null && d.material !== null;
      mesh.castShadow = d.castShadow;
      mesh.receiveShadow = d.receiveShadow;
      mesh.renderOrder = d.renderOrder;
    },
    // 實體移除：描述建立的幾何、材質少一個人用（沒人用時由 resources 釋放）
    dispose(mesh) {
      const slot = slots.get(mesh);
      if (!slot) return;
      if (slot.geometryKey) resources.release(slot.geometryKey);
      if (slot.materialKey) resources.release(slot.materialKey);
      slots.delete(mesh);
    },
  };
}

const EMPTY_GEOMETRY = new THREE.BufferGeometry();
const EMPTY_MATERIAL = new THREE.MeshBasicMaterial();

// ───────── 任意物件 ─────────

export const sceneObjectSpec: BindingSpec<SceneObjectData, THREE.Object3D> = {
  type: SceneObject,
  create: (d) => d.object,
  update(object, d) {
    if (d.object !== object) return d.object; // 換了物件（null 代表移除）
    object.visible = d.visible;
  },
};

// ───────── 攝影機 ─────────

export function createCameraSpec(
  getAspect: (e: Entity) => number,
): BindingSpec<CameraData, THREE.PerspectiveCamera | THREE.OrthographicCamera> {
  const keys = new WeakMap<THREE.Camera, string>();
  return {
    type: Camera,
    create: (d) => (d.kind === 'perspective' ? new THREE.PerspectiveCamera() : new THREE.OrthographicCamera()),
    update(camera, d, e) {
      const isPerspective = camera instanceof THREE.PerspectiveCamera;
      if (isPerspective !== (d.kind === 'perspective')) return this.create(d, camera.userData.entity);

      const aspect = getAspect(e);
      const key = `${d.fov},${d.near},${d.far},${d.size},${d.zoom},${aspect}`;
      if (keys.get(camera) === key) return;
      keys.set(camera, key);

      camera.near = d.near;
      camera.far = d.far;
      camera.zoom = d.zoom;
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = d.fov;
        camera.aspect = aspect;
      } else {
        camera.top = d.size;
        camera.bottom = -d.size;
        camera.left = -d.size * aspect;
        camera.right = d.size * aspect;
      }
      camera.updateProjectionMatrix();
    },
  };
}

// ───────── 燈光 ─────────

type AnyLight =
  | THREE.AmbientLight
  | THREE.HemisphereLight
  | THREE.DirectionalLight
  | THREE.PointLight
  | THREE.SpotLight;

function createLight(d: LightData): AnyLight {
  let light: AnyLight;
  switch (d.kind) {
    case 'ambient':
      light = new THREE.AmbientLight();
      break;
    case 'hemisphere':
      light = new THREE.HemisphereLight();
      break;
    case 'directional':
      light = new THREE.DirectionalLight();
      break;
    case 'point':
      light = new THREE.PointLight();
      break;
    case 'spot':
      light = new THREE.SpotLight();
      break;
  }
  if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
    // 目標放在自身 -Z 方向一單位，讓燈光朝向由變換決定
    light.add(light.target);
    light.target.position.set(0, 0, -1);
  }
  if (light instanceof THREE.AmbientLight || light instanceof THREE.HemisphereLight) {
    // 不跟隨變換；半球光以「上方」作為天空方向
    light.userData[IGNORE_TRANSFORM] = true;
    light.matrix.makeTranslation(0, 1, 0);
    light.matrixWorldNeedsUpdate = true;
  }
  light.userData.kind = d.kind;
  return light;
}

interface LightCache {
  color?: THREE.ColorRepresentation;
  groundColor?: THREE.ColorRepresentation;
  shadowKey?: string;
}

export const lightSpec: BindingSpec<LightData, AnyLight> = {
  type: Light,
  create: createLight,
  update(light, d) {
    if (light.userData.kind !== d.kind) return createLight(d);
    const cache = (light.userData.cache ??= {}) as LightCache;

    // 顏色只在改變時才設定（字串顏色每次解析成本較高）
    if (cache.color !== d.color) {
      light.color.set(d.color);
      cache.color = d.color;
    }
    light.intensity = d.intensity;

    if (light instanceof THREE.HemisphereLight && cache.groundColor !== d.groundColor) {
      light.groundColor.set(d.groundColor);
      cache.groundColor = d.groundColor;
    }
    if (light instanceof THREE.PointLight || light instanceof THREE.SpotLight) {
      light.distance = d.distance;
      light.decay = d.decay;
    }
    if (light instanceof THREE.SpotLight) {
      light.angle = d.angle;
      light.penumbra = d.penumbra;
    }
    if (
      light instanceof THREE.DirectionalLight ||
      light instanceof THREE.PointLight ||
      light instanceof THREE.SpotLight
    ) {
      light.castShadow = d.castShadow;
      const shadowKey = `${d.shadowMapSize},${d.shadowArea}`;
      if (d.castShadow && cache.shadowKey !== shadowKey) {
        cache.shadowKey = shadowKey;
        const shadow = light.shadow;
        shadow.mapSize.set(d.shadowMapSize, d.shadowMapSize);
        shadow.map?.dispose();
        shadow.map = null; // 下次繪製時以新尺寸重建
        if (light instanceof THREE.DirectionalLight) {
          const cam = light.shadow.camera;
          const half = d.shadowArea / 2;
          cam.left = cam.bottom = -half;
          cam.right = cam.top = half;
          cam.updateProjectionMatrix();
        }
      }
    }
  },
  dispose(light) {
    light.dispose();
  },
};
