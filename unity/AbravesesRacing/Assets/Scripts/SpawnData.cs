using System;
using UnityEngine;

namespace AbravesesRacing
{
    [Serializable]
    public class SpawnJsonRoot
    {
        public SpawnVec position;
        public float rotation_y_deg;
    }

    [Serializable]
    public class SpawnVec
    {
        public float x;
        public float y;
        public float z;

        public Vector3 ToUnity() => new Vector3(x, y, z);
    }
}
