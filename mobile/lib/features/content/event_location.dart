/// An event doc's `location` field is `{ lat: number, lng: number,
/// address?: string }` (see firebase/functions/src/modules/events/events.ts)
/// — never a plain string. Casting it directly with `as String?` throws
/// ("type '_Map<String, dynamic>' is not a subtype of type 'String?'")
/// the moment any event actually has a location set, which is exactly
/// what surfaced as a crash on the Home dashboard's Upcoming Events
/// card. This pulls out something displayable instead: the address if
/// the admin entered one, otherwise raw coordinates, otherwise nothing.
String? formatEventLocation(Object? location) {
  if (location is String) return location; // defensive, in case a doc really does store a plain string
  if (location is Map) {
    final address = location['address'];
    if (address is String && address.isNotEmpty) return address;
    final lat = location['lat'];
    final lng = location['lng'];
    if (lat is num && lng is num) return '${lat.toStringAsFixed(4)}, ${lng.toStringAsFixed(4)}';
  }
  return null;
}
