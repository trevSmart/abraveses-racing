using UnityEngine;

namespace AbravesesRacing
{
    /// <summary>
    /// Lightweight arcade kart (Mario Kart–style) on real-world mesh colliders.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public class ArcadeKartController : MonoBehaviour
    {
        [Header("Drive")]
        [SerializeField] private float acceleration = 220f;
        [SerializeField] private float reverseAcceleration = 120f;
        [SerializeField] private float maxSpeed = 42f;
        [SerializeField] private float turnRateDeg = 110f;
        [SerializeField] private float minSteerSpeed = 2.5f;

        [Header("Grip")]
        [SerializeField] private float lateralGrip = 18f;
        [SerializeField] private float downforce = 25f;

        [Header("Brake")]
        [SerializeField] private float brakeStrength = 35f;

        private Rigidbody _body;
        private Vector3 _spawnPosition;
        private float _spawnYawDeg;

        private void Awake()
        {
            _body = GetComponent<Rigidbody>();
            _body.interpolation = RigidbodyInterpolation.Interpolate;
            _body.constraints = RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationZ;
            _body.centerOfMass = new Vector3(0f, -0.35f, 0f);
            _spawnPosition = transform.position;
            _spawnYawDeg = transform.eulerAngles.y;
        }

        public void ApplySpawn(Vector3 position, float yawDegrees, bool resetVelocity = true)
        {
            _spawnPosition = position;
            _spawnYawDeg = yawDegrees;
            transform.SetPositionAndRotation(position, Quaternion.Euler(0f, yawDegrees, 0f));
            if (resetVelocity && !_body.isKinematic)
            {
                _body.linearVelocity = Vector3.zero;
                _body.angularVelocity = Vector3.zero;
            }
        }

        private void Update()
        {
            if (Input.GetKeyDown(KeyCode.R))
            {
                ApplySpawn(_spawnPosition, _spawnYawDeg);
            }
        }

        private void FixedUpdate()
        {
            float throttle = 0f;
            if (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow))
            {
                throttle = 1f;
            }
            else if (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow))
            {
                throttle = -0.55f;
            }

            float steer = 0f;
            if (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow))
            {
                steer += 1f;
            }

            if (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow))
            {
                steer -= 1f;
            }

            Vector3 velocity = _body.linearVelocity;
            Vector3 flatVel = Vector3.ProjectOnPlane(velocity, Vector3.up);
            float speed = flatVel.magnitude;

            if (throttle > 0f && speed < maxSpeed)
            {
                _body.AddForce(transform.forward * (acceleration * throttle), ForceMode.Acceleration);
            }
            else if (throttle < 0f)
            {
                _body.AddForce(transform.forward * (reverseAcceleration * throttle), ForceMode.Acceleration);
            }

            if (Input.GetKey(KeyCode.Space) && speed > 0.5f)
            {
                _body.AddForce(-flatVel.normalized * brakeStrength, ForceMode.Acceleration);
            }

            if (Mathf.Abs(steer) > 0.01f && speed > minSteerSpeed)
            {
                float speedFactor = Mathf.Clamp01(speed / maxSpeed);
                float delta = steer * turnRateDeg * speedFactor * Time.fixedDeltaTime;
                transform.Rotate(0f, delta, 0f, Space.World);
            }

            float lateral = Vector3.Dot(flatVel, transform.right);
            _body.AddForce(-transform.right * (lateral * lateralGrip), ForceMode.Acceleration);
            _body.AddForce(-Vector3.up * downforce * speed, ForceMode.Force);

            if (transform.position.y < -25f)
            {
                ApplySpawn(_spawnPosition, _spawnYawDeg);
            }
        }
    }
}
