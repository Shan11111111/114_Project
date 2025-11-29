using System.Collections;
using System.Collections.Generic;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

[System.Serializable]
public class ChatMessageDTO {
    public string role;   // "user" / "assistant"
    public string type;   // "text" / "image" / "file"
    public string content;
    public string url;
    public string filetype;
}

[System.Serializable]
public class ActionDTO {
    public string type;          // e.g. "highlight_bones"
    public string target_model;  // e.g. "knee_v1"
    public string[] bones;       // e.g. ["Femur_L","Tibia_L"]
    public string image_url;
}

[System.Serializable]
public class ChatRequestDTO {
    public string session_id;
    public ChatMessageDTO[] messages;
}

[System.Serializable]
public class ChatResponseDTO {
    public ChatMessageDTO[] messages;
    public ActionDTO[] actions;
}

public class AIAgentClient : MonoBehaviour
{
    [Header("Server Settings")]
    public string baseUrl = "http://127.0.0.1:8000";
    public string sessionId = "unity-demo";

    [Header("Refs")]
    public BoneHighlighter boneHighlighter;

    public void SendText(string text)
    {
        var msg = new ChatMessageDTO {
            role = "user",
            type = "text",
            content = text,
            url = null,
            filetype = null
        };
        var req = new ChatRequestDTO {
            session_id = sessionId,
            messages = new ChatMessageDTO[] { msg }
        };
        StartCoroutine(PostChat(req));
    }

    private IEnumerator PostChat(ChatRequestDTO req)
    {
        string url = baseUrl + "/agent/chat";
        string json = JsonUtility.ToJson(req);

        using (var www = new UnityWebRequest(url, "POST"))
        {
            byte[] body = Encoding.UTF8.GetBytes(json);
            www.uploadHandler = new UploadHandlerRaw(body);
            www.downloadHandler = new DownloadHandlerBuffer();
            www.SetRequestHeader("Content-Type", "application/json");

            yield return www.SendWebRequest();

            if (www.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError("AI Agent error: " + www.error);
                yield break;
            }

            var resJson = www.downloadHandler.text;
            var res = JsonUtility.FromJson<ChatResponseDTO>(resJson);

            if (res.actions != null && boneHighlighter != null)
            {
                foreach (var act in res.actions)
                {
                    if (act.type == "highlight_bones" && act.bones != null)
                    {
                        boneHighlighter.HighlightBones(act.bones);
                    }
                }
            }

            Debug.Log("AI Agent response: " + resJson);
        }
    }
}
