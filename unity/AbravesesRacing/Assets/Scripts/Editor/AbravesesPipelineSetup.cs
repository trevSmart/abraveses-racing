using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace AbravesesRacing.Editor
{
    public static class AbravesesPipelineSetup
    {
        private const string SettingsDir = "Assets/Settings";
        private const string RendererPath = SettingsDir + "/UniversalRenderer.asset";
        private const string PipelinePath = SettingsDir + "/UniversalRP.asset";

        [MenuItem("Abraveses/Setup URP (render pipeline)")]
        public static void SetupFromMenu()
        {
            if (SetupInternal())
            {
                EditorUtility.DisplayDialog(
                    "Abraveses Racing",
                    "URP configured. The Hub deprecation warning should disappear after Unity reloads.",
                    "OK");
            }
        }

        [InitializeOnLoadMethod]
        private static void AutoSetupOnLoad()
        {
            EditorApplication.delayCall += () =>
            {
                if (GraphicsSettings.defaultRenderPipeline != null)
                {
                    return;
                }

                if (!File.Exists(Path.Combine(Application.dataPath, "Scripts/AbravesesRendering.cs")))
                {
                    return;
                }

                SetupInternal();
            };
        }

        private static bool SetupInternal()
        {
            if (!AssetDatabase.IsValidFolder(SettingsDir))
            {
                AssetDatabase.CreateFolder("Assets", "Settings");
            }

            var renderer = AssetDatabase.LoadAssetAtPath<UniversalRendererData>(RendererPath);
            if (renderer == null)
            {
                renderer = ScriptableObject.CreateInstance<UniversalRendererData>();
                AssetDatabase.CreateAsset(renderer, RendererPath);
            }

            var pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(PipelinePath);
            if (pipeline == null)
            {
                pipeline = ScriptableObject.CreateInstance<UniversalRenderPipelineAsset>();
                AssetDatabase.CreateAsset(pipeline, PipelinePath);
            }

            var pipelineSo = new SerializedObject(pipeline);
            var rendererList = pipelineSo.FindProperty("m_RendererDataList");
            rendererList.arraySize = 1;
            rendererList.GetArrayElementAtIndex(0).objectReferenceValue = renderer;
            pipelineSo.ApplyModifiedPropertiesWithoutUndo();

            GraphicsSettings.defaultRenderPipeline = pipeline;

            var qualityNames = QualitySettings.names;
            for (var i = 0; i < qualityNames.Length; i++)
            {
                QualitySettings.SetQualityLevel(i, false);
                QualitySettings.renderPipeline = pipeline;
            }

            EditorUtility.SetDirty(pipeline);
            EditorUtility.SetDirty(renderer);
            AssetDatabase.SaveAssets();
            return true;
        }
    }
}
