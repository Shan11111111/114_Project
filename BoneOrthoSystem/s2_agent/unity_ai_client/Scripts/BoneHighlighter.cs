using System.Collections.Generic;
using UnityEngine;

public class BoneHighlighter : MonoBehaviour
{
    [System.Serializable]
    public class BoneEntry
    {
        public string boneName;  // e.g. "Femur_L"
        public Renderer renderer;
    }

    public List<BoneEntry> bones = new List<BoneEntry>();
    public Color highlightColor = Color.yellow;
    public Color normalColor = Color.white;

    private Dictionary<string, BoneEntry> _boneMap;

    void Awake()
    {
        _boneMap = new Dictionary<string, BoneEntry>();
        foreach (var b in bones)
        {
            if (b != null && b.renderer != null && !string.IsNullOrEmpty(b.boneName))
            {
                _boneMap[b.boneName] = b;
                SetRendererColor(b.renderer, normalColor);
            }
        }
    }

    public void HighlightBones(string[] boneNames)
    {
        // 先全部恢復成 normal
        foreach (var kv in _boneMap)
        {
            SetRendererColor(kv.Value.renderer, normalColor);
        }

        if (boneNames == null) return;

        foreach (var name in boneNames)
        {
            if (_boneMap.TryGetValue(name, out var entry))
            {
                SetRendererColor(entry.renderer, highlightColor);
            }
        }
    }

    private void SetRendererColor(Renderer r, Color c)
    {
        if (r == null) return;
        if (r.material != null)
        {
            r.material.color = c;
        }
    }
}
