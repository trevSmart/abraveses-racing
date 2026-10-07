using UnityEngine;

namespace AbravesesRacing
{
    /// <summary>
    /// If you press Play on an empty scene, spawn the Abraveses world and kart automatically.
    /// </summary>
    public static class AbravesesPlayModeSetup
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void BootstrapIfNeeded()
        {
            if (Object.FindAnyObjectByType<ArcadeKartController>() != null)
            {
                return;
            }

            var worldPrefab = AbravesesGameFactory.LoadWorldModelPrefab();
            if (worldPrefab == null)
            {
                Debug.LogWarning(
                    "Abraveses: no world.obj found. Run python tools/mapgen/build_world.py --all");
                return;
            }

            AbravesesGameFactory.EnsureSceneBasics(out Camera camera);

            // World + colliders before the kart simulates (avoids falling through on frame 0).
            var worldRoot = new GameObject("WorldRoot");
            var bootstrap = worldRoot.AddComponent<WorldBootstrap>();
            var kart = AbravesesGameFactory.CreateKart();
            bootstrap.ConfigureForPlay(worldPrefab, kart);
            bootstrap.BuildNow();

            AbravesesGameFactory.AttachCameraFollow(camera, kart.transform);
        }
    }
}
