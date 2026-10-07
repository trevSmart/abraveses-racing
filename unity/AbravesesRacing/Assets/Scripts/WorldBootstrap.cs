using System.IO;
using UnityEngine;

namespace AbravesesRacing
{
    /// <summary>
    /// Instantiates the generated OSM/DEM mesh and applies kart spawn from spawn.json.
    /// Convention: 1 Unity unit = 1 metre (Y-up, same as mapgen export).
    /// </summary>
    [DefaultExecutionOrder(-500)]
    public class WorldBootstrap : MonoBehaviour
    {
        [SerializeField] private GameObject worldModelPrefab;
        [SerializeField] private string spawnJsonFileName = "spawn.json";
        [SerializeField] private ArcadeKartController kart;

        private bool _built;

        public void ConfigureForPlay(GameObject worldSource, ArcadeKartController kartController)
        {
            worldModelPrefab = worldSource;
            kart = kartController;
        }

        private void Awake()
        {
            if (worldModelPrefab != null)
            {
                BuildNow();
            }
        }

        /// <summary>Load world mesh and colliders immediately (before physics ticks).</summary>
        public void BuildNow()
        {
            if (_built)
            {
                return;
            }

            _built = true;

            if (worldModelPrefab == null)
            {
                Debug.LogWarning(
                    "Assign world.obj on WorldBootstrap. Run: python tools/mapgen/build_world.py --all");
                return;
            }

            var world = Instantiate(worldModelPrefab, transform);
            world.name = "AbravesesWorld";
            ApplyDefaultMaterials(world);

            if (!AddMeshColliders(world))
            {
                Debug.LogError(
                    "Abraveses: world collision mesh failed. Reimport world.obj with Read/Write enabled.");
            }

            Physics.SyncTransforms();
            ApplySpawnFromJson();
        }

        private static void ApplyDefaultMaterials(GameObject root)
        {
            var grass = CreateMat(new Color(0.45f, 0.72f, 0.38f));
            var road = CreateMat(new Color(0.28f, 0.28f, 0.30f));
            var building = CreateMat(new Color(0.86f, 0.71f, 0.55f));

            foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>(true))
            {
                var bounds = renderer.bounds;
                var size = bounds.size;
                var height = size.y;
                if (height > 2.5f)
                {
                    renderer.sharedMaterial = building;
                }
                else if (height < 0.6f && (size.x > 3f || size.z > 3f))
                {
                    renderer.sharedMaterial = road;
                }
                else
                {
                    renderer.sharedMaterial = grass;
                }
            }
        }

        private static Material CreateMat(Color color)
        {
            return AbravesesRendering.CreateColorMaterial(color);
        }

        private static bool AddMeshColliders(GameObject root)
        {
            var added = 0;
            foreach (var mf in root.GetComponentsInChildren<MeshFilter>(true))
            {
                if (mf.sharedMesh == null)
                {
                    continue;
                }

                var go = mf.gameObject;
                if (go.GetComponent<MeshCollider>() != null)
                {
                    continue;
                }

                var mc = go.AddComponent<MeshCollider>();
                mc.sharedMesh = mf.sharedMesh;
                mc.convex = false;
                added++;
            }

            return added > 0;
        }

        private void ApplySpawnFromJson()
        {
            if (kart == null)
            {
                return;
            }

            var path = Path.Combine(Application.dataPath, "World", spawnJsonFileName);
            if (!File.Exists(path))
            {
                Debug.LogWarning($"Missing spawn file: {path}");
                return;
            }

            var json = File.ReadAllText(path);
            var data = JsonUtility.FromJson<SpawnJsonRoot>(json);
            if (data?.position == null)
            {
                return;
            }

            var rb = kart.GetComponent<Rigidbody>();
            if (rb != null)
            {
                rb.isKinematic = true;
            }

            kart.ApplySpawn(data.position.ToUnity(), data.rotation_y_deg, resetVelocity: false);
            Physics.SyncTransforms();

            if (rb != null)
            {
                rb.isKinematic = false;
                rb.linearVelocity = Vector3.zero;
                rb.angularVelocity = Vector3.zero;
            }
        }
    }
}
