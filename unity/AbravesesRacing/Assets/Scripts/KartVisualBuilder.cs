using UnityEngine;

namespace AbravesesRacing
{
    /// <summary>Low-poly arcade kart (body + nose + wheels), no colliders on visuals.</summary>
    public static class KartVisualBuilder
    {
        private static readonly Color BodyColor = new Color(0.92f, 0.18f, 0.15f);
        private static readonly Color AccentColor = new Color(0.98f, 0.78f, 0.12f);
        private static readonly Color WheelColor = new Color(0.12f, 0.12f, 0.14f);

        public static void Attach(GameObject kartRoot)
        {
            var visual = new GameObject("Visual");
            visual.transform.SetParent(kartRoot.transform, false);

            var body = Primitive(PrimitiveType.Cube, visual.transform, "Body");
            body.transform.localScale = new Vector3(1.15f, 0.42f, 1.75f);
            body.transform.localPosition = new Vector3(0f, 0.18f, 0.05f);
            Paint(body, BodyColor);

            var nose = Primitive(PrimitiveType.Cube, visual.transform, "Nose");
            nose.transform.localScale = new Vector3(0.75f, 0.28f, 0.55f);
            nose.transform.localPosition = new Vector3(0f, 0.12f, 1.05f);
            Paint(nose, AccentColor);

            var spoiler = Primitive(PrimitiveType.Cube, visual.transform, "Spoiler");
            spoiler.transform.localScale = new Vector3(1.05f, 0.08f, 0.22f);
            spoiler.transform.localPosition = new Vector3(0f, 0.48f, -0.85f);
            Paint(spoiler, AccentColor);

            CreateWheel(visual.transform, new Vector3(-0.62f, 0.02f, 0.72f));
            CreateWheel(visual.transform, new Vector3(0.62f, 0.02f, 0.72f));
            CreateWheel(visual.transform, new Vector3(-0.62f, 0.02f, -0.62f));
            CreateWheel(visual.transform, new Vector3(0.62f, 0.02f, -0.62f));
        }

        private static GameObject Primitive(PrimitiveType type, Transform parent, string name)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            go.transform.SetParent(parent, false);
            Object.Destroy(go.GetComponent<Collider>());
            return go;
        }

        private static void CreateWheel(Transform parent, Vector3 localPos)
        {
            var wheel = Primitive(PrimitiveType.Cylinder, parent, "Wheel");
            wheel.transform.localPosition = localPos;
            wheel.transform.localScale = new Vector3(0.42f, 0.12f, 0.42f);
            wheel.transform.localRotation = Quaternion.Euler(0f, 0f, 90f);
            Paint(wheel, WheelColor);
        }

        private static void Paint(GameObject go, Color color)
        {
            var renderer = go.GetComponent<MeshRenderer>();
            if (renderer != null)
            {
                renderer.sharedMaterial = AbravesesRendering.CreateColorMaterial(color, 0.45f);
            }
        }
    }
}
