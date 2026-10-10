// Càmera fixa al joc (http://localhost:5173) per comparar una casa amb les fotos.
// Enganxa-ho a la consola del navegador (o al javascript_tool de Claude in Chrome) quan el món
// s'hagi carregat (~10 s). Les coordenades són UTM (EPSG:25830), com les de casa_info.py.
//
//   __view(E, N, h, tE, tN, th)  càmera a (E, N) a l'alçada h, mirant el punt (tE, tN, th)
//   __free()                      torna a la càmera de seguiment
//   __go(E, N, rumb)              porta el cotxe a (E, N), amb el rumb de la brúixola (0 = nord)
//
// Les alçades són les del món del joc, no altituds: el terra del poble és a uns 2 m. Per mirar
// com una persona, fes servir l'alçada del cotxe (HUD «… m») + 1,6, aproximadament.
// L'origen UTM del món es llegeix de /world_meta.json (web/public/world_meta.json).
(async () => {
  const d = window.__dbg;
  if (!d) throw new Error("window.__dbg no hi és: el món encara no s'ha carregat");
  const meta = await (await fetch("/world_meta.json")).json();
  const ox = meta.origin_utm_x;
  const oy = meta.origin_utm_y;
  const loc = (E, N) => [E - ox, -(N - oy)];
  window.__go = (E, N, rumb) => {
    // Al joc el heading 0 mira al sud (+Z); la brúixola del HUD és 180° − heading.
    const h = Math.PI - (rumb * Math.PI) / 180;
    const [x, z] = loc(E, N);
    d.kart.position.x = x;
    d.kart.position.z = z;
    d.state.heading = h;
    d.kart.rotation.y = h;
    d.state.speed = 0;
    d.placeCameraBehindKart();
    return d.kart.position.y; // alçada del terra (aprox.) en aquest punt
  };
  window.__view = (E, N, h, tE, tN, th) => {
    const [x, z] = loc(E, N);
    const [tx, tz] = loc(tE, tN);
    // Es fixa just abans de cada render: la càmera de seguiment no la mou.
    d.scene.onBeforeRender = () => {
      d.camera.position.set(x, h, z);
      d.camera.lookAt(tx, th, tz);
      d.camera.updateMatrixWorld();
    };
    return "ok";
  };
  window.__free = () => {
    d.scene.onBeforeRender = () => {};
    return "ok";
  };
  return "__go, __view i __free a punt";
})();
