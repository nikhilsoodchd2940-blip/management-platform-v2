import 'package:cached_network_image/cached_network_image.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Reads banners/{id} ordered by `order`, filtered to active==true —
/// admin-managed from the web panel's Banners page (see
/// firebase/functions/src/modules/content/content.ts). Renders nothing
/// at all when there are no active banners, so it never leaves an empty
/// gap on screens that don't have any configured yet.
class BannerCarousel extends StatefulWidget {
  const BannerCarousel({super.key});

  @override
  State<BannerCarousel> createState() => _BannerCarouselState();
}

class _BannerCarouselState extends State<BannerCarousel> {
  final _controller = PageController(viewportFraction: 0.92);
  int _page = 0;

  Future<void> _openLink(String? url) async {
    if (url == null || url.isEmpty) return;
    final uri = Uri.tryParse(url);
    if (uri != null && await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = FirebaseFirestore.instance
        .collection('banners')
        .where('active', isEqualTo: true)
        .orderBy('order');

    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: query.snapshots(),
      builder: (context, snap) {
        final docs = snap.data?.docs ?? [];
        if (docs.isEmpty) return const SizedBox.shrink();

        return Padding(
          padding: const EdgeInsets.only(top: 12, bottom: 4),
          child: Column(
            children: [
              SizedBox(
                height: 140,
                child: PageView.builder(
                  controller: _controller,
                  itemCount: docs.length,
                  onPageChanged: (i) => setState(() => _page = i),
                  itemBuilder: (context, i) {
                    final data = docs[i].data();
                    final imageUrl = data['imageUrl'] as String? ?? '';
                    final linkUrl = data['linkUrl'] as String?;
                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: GestureDetector(
                        onTap: linkUrl == null ? null : () => _openLink(linkUrl),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(18),
                          child: imageUrl.isEmpty
                              ? Container(color: Theme.of(context).colorScheme.primaryContainer)
                              // Was Image.network — re-fetched from the
                              // network on every single app open with no
                              // disk cache, which is most of what made
                              // "display banners" feel slow. This caches
                              // to disk after the first load, so a
                              // returning user sees it instantly.
                              : CachedNetworkImage(
                                  imageUrl: imageUrl,
                                  fit: BoxFit.cover,
                                  width: double.infinity,
                                  fadeInDuration: const Duration(milliseconds: 150),
                                  placeholder: (context, url) =>
                                      Container(color: Theme.of(context).colorScheme.primaryContainer),
                                  errorWidget: (context, url, error) =>
                                      Container(color: Theme.of(context).colorScheme.primaryContainer),
                                ),
                        ),
                      ),
                    );
                  },
                ),
              ),
              if (docs.length > 1) ...[
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(docs.length, (i) {
                    final active = i == _page;
                    return AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      width: active ? 16 : 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: active
                            ? Theme.of(context).colorScheme.primary
                            : Theme.of(context).colorScheme.outlineVariant,
                        borderRadius: BorderRadius.circular(3),
                      ),
                    );
                  }),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}
