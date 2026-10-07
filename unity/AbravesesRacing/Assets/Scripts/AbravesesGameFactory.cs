using UnityEngine;

namespace AbravesesRacing
{
    /// <summary>
    /// Builds kart, camera, lighting and world root (shared by editor menu and Play auto-setup).
    /// </summary>
    public static class AbravesesGameFactory
    {
        public const string WorldObjAssetPath = "Assets/World/world.obj";

        public static GameObject LoadWorldModelPrefab()
        {
#if UNITY_EDITOR
            return UnityEditor.AssetDatabase.LoadAssetAtPath<GameObject>(WorldObjAssetPath);
#else
            return null;
#endif
        }

        public static void EnsureSceneBasics(out Camera camera)
        {
            camera = Camera.main;
            if (camera != null)
            {
                return;
            }

            var camGo = new GameObject("Main Camera");
            camGo.tag = "MainCamera";
            camera = camGo.AddComponent<Camera>();
            camGo.AddComponent<AudioListener>();
            camGo.transform.position = new Vector3(0f, 8f, -12f);

            if (Object.FindAnyObjectByType<Light>() == null)
            {
                var lightGo = new GameObject("Directional Light");
                var light = lightGo.AddComponent<Light>();
                light.type = LightType.Directional;
                light.intensity = 1.1f;
                lightGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
            }
        }

        public static ArcadeKartController CreateKart()
        {
            var kartGo = new GameObject("Kart");

            var body = kartGo.AddComponent<Rigidbody>();
            body.mass = 280f;
            body.linearDamping = 0.2f;
            body.angularDamping = 2f;

            var box = kartGo.AddComponent<BoxCollider>();
            box.size = new Vector3(1.35f, 0.75f, 2.15f);
            box.center = new Vector3(0f, 0.22f, 0.05f);

            KartVisualBuilder.Attach(kartGo);

            return kartGo.AddComponent<ArcadeKartController>();
        }

        public static WorldBootstrap CreateWorldRoot(GameObject worldPrefab, ArcadeKartController kart)
        {
            var worldRoot = new GameObject("WorldRoot");
            var bootstrap = worldRoot.AddComponent<WorldBootstrap>();
            bootstrap.ConfigureForPlay(worldPrefab, kart);
            bootstrap.BuildNow();
            return bootstrap;
        }

        public static void AttachCameraFollow(Camera camera, Transform kartTransform)
        {
            if (camera == null || kartTransform == null)
            {
                return;
            }

            var follow = camera.GetComponent<KartCameraFollow>();
            if (follow == null)
            {
                follow = camera.gameObject.AddComponent<KartCameraFollow>();
            }

            follow.SetTarget(kartTransform);
        }
    }
}
