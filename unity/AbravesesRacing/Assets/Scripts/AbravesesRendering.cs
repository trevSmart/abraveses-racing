using UnityEngine;

namespace AbravesesRacing
{
    /// <summary>URP Lit with Built-in Standard fallback (during migration).</summary>
    public static class AbravesesRendering
    {
        private static Shader _litShader;

        public static Shader LitShader
        {
            get
            {
                if (_litShader != null)
                {
                    return _litShader;
                }

                _litShader = Shader.Find("Universal Render Pipeline/Lit");
                if (_litShader == null)
                {
                    _litShader = Shader.Find("Standard");
                }

                return _litShader;
            }
        }

        public static Material CreateColorMaterial(Color color, float smoothness = 0.35f)
        {
            var mat = new Material(LitShader);
            if (mat.HasProperty("_BaseColor"))
            {
                mat.SetColor("_BaseColor", color);
            }
            else
            {
                mat.color = color;
            }

            if (mat.HasProperty("_Smoothness"))
            {
                mat.SetFloat("_Smoothness", smoothness);
            }

            return mat;
        }
    }
}
