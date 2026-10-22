// Native layout: commas separate every cell, including cells across line breaks.
export const nativeBuildingXml = `<building version="3" width="2" height="2" Door="1">
  <properties><property name="empty" value=""/><property name="label" value="A &amp; B &lt;C&gt;"/>
    <property name="notes">first line
second line</property></properties>
  <tile_entry category="doors"><tile enum="West" tile="fixtures_doors_01_000" offset="1 -2"/></tile_entry>
  <furniture><entry orient="W"><tile x="0" y="0" name="furniture_seating_indoor_01_000"/></entry></furniture>
  <furniture layer="Walls" corners="true"><entry orient="NW" grime="false">
    <tile x="0" y="0" name="furniture_seating_indoor_01_001"/></entry></furniture>
  <user_tiles><tile tile="floors_interior_tilesandwood_01_000"/></user_tiles>
  <used_tiles>1</used_tiles><used_furniture>1 0</used_furniture>
  <room Name="Office" InternalName="office" Color="100 120 140"/>
  <floor><object type="furniture" x="0" y="0" FurnitureTiles="1" orient="NW"/>
    <object type="door" x="1" y="0" dir="W" Tile="1" FrameTile="0"/>
    <rooms>
1,0,
0,1
</rooms><tiles layer="Floor">
1,0,0,
0,1,0,
0,0,1
</tiles></floor></building>`;

