using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace AbravesesRacing.Editor
{
    public static class AbravesesSceneSetup
    {
        private const string ScenePath = "Assets/Scenes/Main.unity";

        [MenuItem("Abraveses/Setup Main Scene")]
        public static void SetupMainScene()
        {
            if (!File.Exists(Path.Combine(Application.dataPath, "World/world.obj")))
            {
                EditorUtility.DisplayDialog(
                    "Abraveses Racing",
                    "No world mesh in Assets/World/. From repo root run:\n\n" +
                    "python tools/mapgen/build_world.py --all",
                    "OK");
                return;
            }

            AssetDatabase.Refresh();

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var worldPrefab = AbravesesGameFactory.LoadWorldModelPrefab();
            AbravesesGameFactory.EnsureSceneBasics(out Camera camera);
            var kart = AbravesesGameFactory.CreateKart();
            AbravesesGameFactory.CreateWorldRoot(worldPrefab, kart);
            AbravesesGameFactory.AttachCameraFollow(camera, kart.transform);

            Directory.CreateDirectory(Path.Combine(Application.dataPath, "Scenes"));
            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };

            EditorUtility.DisplayDialog(
                "Abraveses Racing",
                $"Scene saved to {ScenePath}. Press Play to drive around Abraveses de Tera.",
                "OK");
        }
    }
}
