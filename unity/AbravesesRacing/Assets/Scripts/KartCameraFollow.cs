using UnityEngine;

namespace AbravesesRacing
{
    public class KartCameraFollow : MonoBehaviour
    {
        [SerializeField] private Transform target;
        [SerializeField] private Vector3 offset = new Vector3(0f, 6f, -12f);
        [SerializeField] private float followSmooth = 8f;
        [SerializeField] private float lookAhead = 4f;

        public void SetTarget(Transform t)
        {
            target = t;
        }

        private void LateUpdate()
        {
            if (target == null)
            {
                return;
            }

            Vector3 desired = target.TransformPoint(offset);
            transform.position = Vector3.Lerp(
                transform.position,
                desired,
                1f - Mathf.Exp(-followSmooth * Time.deltaTime));

            Vector3 lookAt = target.position + target.forward * lookAhead + Vector3.up * 1.2f;
            transform.rotation = Quaternion.Lerp(
                transform.rotation,
                Quaternion.LookRotation(lookAt - transform.position, Vector3.up),
                1f - Mathf.Exp(-followSmooth * Time.deltaTime));
        }
    }
}
