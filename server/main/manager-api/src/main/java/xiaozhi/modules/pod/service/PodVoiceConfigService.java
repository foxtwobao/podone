package xiaozhi.modules.pod.service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;

import lombok.AllArgsConstructor;
import xiaozhi.common.constant.Constant;
import xiaozhi.common.utils.JsonUtils;
import xiaozhi.modules.model.entity.ModelConfigEntity;
import xiaozhi.modules.model.service.ModelConfigService;
import xiaozhi.modules.pod.dto.PodVoiceOption;
import xiaozhi.modules.sys.dto.SysParamsDTO;
import xiaozhi.modules.sys.entity.SysParamsEntity;
import xiaozhi.modules.sys.service.SysParamsService;
import xiaozhi.modules.timbre.dao.TimbreDao;
import xiaozhi.modules.timbre.entity.TimbreEntity;

@Service
@AllArgsConstructor
public class PodVoiceConfigService {
    public static final String VOICE_MODELS_PARAM = "podone.voice.models";
    public static final String VOICE_CATALOG_PARAM = "podone.voice.catalog";
    public static final String BOTONE_URL_PARAM = "podone.botone.url";

    private static final List<String> CORE_INFRA_PARAM_CODES = List.of(
            Constant.SERVER_FRONTED_URL,
            Constant.SERVER_WEBSOCKET,
            Constant.SERVER_OTA,
            Constant.SERVER_AUTH_ENABLED);

    private final SysParamsService params;
    private final ModelConfigService modelConfigService;
    private final TimbreDao timbreDao;

    public Map<String, String> getVoiceModels() {
        String raw = params.getValue(VOICE_MODELS_PARAM, false);
        Map<String, Object> parsed;
        try {
            parsed = JsonUtils.parseMap(raw);
        } catch (RuntimeException ignored) {
            return Collections.emptyMap();
        }
        if (parsed == null) {
            return Collections.emptyMap();
        }
        Map<String, String> result = new LinkedHashMap<>();
        for (String field : new String[] { "chatModel", "ttsModel", "ttsVoice" }) {
            if (parsed.get(field) instanceof String value && StringUtils.isNotBlank(value)) {
                result.put(field, value.trim());
            }
        }
        return result;
    }

    public boolean isVoiceConfigured(Map<String, String> models) {
        return StringUtils.isNotBlank(models.get("chatModel"))
                && StringUtils.isNotBlank(models.get("ttsModel"))
                && StringUtils.isNotBlank(models.get("ttsVoice"));
    }

    public boolean hasCustomVoiceCatalog() {
        return !parseCustomCatalog().isEmpty();
    }

    public List<PodVoiceOption> getVoiceCatalog(boolean enabledOnly) {
        List<PodVoiceOption> custom = parseCustomCatalog();
        if (!custom.isEmpty()) {
            return filterAndDedupe(custom, enabledOnly);
        }

        Map<String, String> models = getVoiceModels();
        String ttsModel = models.get("ttsModel");
        String defaultVoice = models.get("ttsVoice");

        List<PodVoiceOption> builtin = loadBuiltinVoices(ttsModel);
        if (!builtin.isEmpty()) {
            List<PodVoiceOption> deduped = filterAndDedupe(builtin, enabledOnly);
            if (StringUtils.isNotBlank(defaultVoice)
                    && deduped.stream().noneMatch(v -> defaultVoice.equals(v.getId()))) {
                List<PodVoiceOption> withDefault = new ArrayList<>(deduped.size() + 1);
                withDefault.add(new PodVoiceOption(defaultVoice, defaultVoice, "系统默认音色", true));
                withDefault.addAll(deduped);
                return withDefault;
            }
            return deduped;
        }

        if (StringUtils.isNotBlank(defaultVoice)) {
            return List.of(new PodVoiceOption(defaultVoice, defaultVoice, "系统默认音色", true));
        }
        return Collections.emptyList();
    }

    private List<PodVoiceOption> parseCustomCatalog() {
        String raw = params.getValue(VOICE_CATALOG_PARAM, false);
        if (StringUtils.isBlank(raw)) {
            return Collections.emptyList();
        }
        try {
            List<PodVoiceOption> parsed = JsonUtils.parseArray(raw, PodVoiceOption.class);
            if (parsed == null) {
                return Collections.emptyList();
            }
            List<PodVoiceOption> clean = new ArrayList<>();
            for (PodVoiceOption item : parsed) {
                if (item == null || StringUtils.isBlank(item.getId())) {
                    continue;
                }
                clean.add(new PodVoiceOption(
                        item.getId().trim(),
                        StringUtils.defaultIfBlank(item.getName(), item.getId()).trim(),
                        StringUtils.trimToEmpty(item.getDesc()),
                        item.isEnabled()));
            }
            return clean;
        } catch (RuntimeException ignored) {
            return Collections.emptyList();
        }
    }

    private List<PodVoiceOption> loadBuiltinVoices(String ttsModel) {
        if (StringUtils.isBlank(ttsModel)) {
            return Collections.emptyList();
        }
        List<ModelConfigEntity> ttsModels = modelConfigService.getEnabledModelsByType("TTS");
        if (ttsModels == null || ttsModels.isEmpty()) {
            return Collections.emptyList();
        }
        ModelConfigEntity matched = findMatchingTtsConfig(ttsModels, ttsModel.trim());
        if (matched == null || StringUtils.isBlank(matched.getId())) {
            return Collections.emptyList();
        }
        List<TimbreEntity> rows = timbreDao.selectList(new QueryWrapper<TimbreEntity>()
                .eq("tts_model_id", matched.getId())
                .orderByAsc("sort"));
        if (rows == null || rows.isEmpty()) {
            return Collections.emptyList();
        }
        List<PodVoiceOption> result = new ArrayList<>(rows.size());
        for (TimbreEntity row : rows) {
            if (row == null || StringUtils.isBlank(row.getTtsVoice())) {
                continue;
            }
            String desc = StringUtils.isNotBlank(row.getRemark())
                    ? row.getRemark().trim()
                    : StringUtils.trimToEmpty(row.getLanguages());
            result.add(new PodVoiceOption(
                    row.getTtsVoice().trim(),
                    StringUtils.defaultIfBlank(row.getName(), row.getTtsVoice()).trim(),
                    desc,
                    true));
        }
        return result;
    }

    private static ModelConfigEntity findMatchingTtsConfig(List<ModelConfigEntity> candidates, String ttsModel) {
        for (ModelConfigEntity item : candidates) {
            String configured = item.getConfigJson() == null ? null : item.getConfigJson().getStr("model");
            if (StringUtils.isNotBlank(configured) && configured.trim().equalsIgnoreCase(ttsModel)) {
                return item;
            }
        }
        // Fallback for model family upgrades (e.g. MiniMax speech-01-turbo -> speech-2.6-turbo).
        if (ttsModel.toLowerCase().startsWith("speech-")) {
            for (ModelConfigEntity item : candidates) {
                String configured = item.getConfigJson() == null ? null : item.getConfigJson().getStr("model");
                if (StringUtils.isNotBlank(configured) && configured.trim().toLowerCase().startsWith("speech-")) {
                    return item;
                }
            }
        }
        return null;
    }

    private static List<PodVoiceOption> filterAndDedupe(List<PodVoiceOption> items, boolean enabledOnly) {
        Map<String, PodVoiceOption> byId = new LinkedHashMap<>();
        for (PodVoiceOption item : items) {
            if (item == null || StringUtils.isBlank(item.getId())) {
                continue;
            }
            if (enabledOnly && !item.isEnabled()) {
                continue;
            }
            byId.putIfAbsent(item.getId().trim(), item);
        }
        return new ArrayList<>(byId.values());
    }

    public String getBotoneUrl() {
        String raw = params.getValue(BOTONE_URL_PARAM, false);
        if (StringUtils.isBlank(raw)) {
            return "";
        }
        return StringUtils.removeEnd(raw.trim(), "/");
    }

    public void saveVoiceConfig(String chatModel, String ttsModel, String ttsVoice,
            String botoneUrl, List<PodVoiceOption> catalog) {
        Map<String, String> models = new LinkedHashMap<>();
        if (StringUtils.isNotBlank(chatModel)) {
            models.put("chatModel", chatModel.trim());
        }
        if (StringUtils.isNotBlank(ttsModel)) {
            models.put("ttsModel", ttsModel.trim());
        }
        if (StringUtils.isNotBlank(ttsVoice)) {
            models.put("ttsVoice", ttsVoice.trim());
        }
        upsertParam(VOICE_MODELS_PARAM, JsonUtils.toJsonString(models), "json",
                "chatModel 和 ttsModel 填 TokenONE 模型 ID，ttsVoice 填所选 TTS 通道支持的音色");

        if (catalog != null) {
            List<PodVoiceOption> cleanCatalog = filterAndDedupe(catalog, false);
            String catalogJson = JsonUtils.toJsonString(cleanCatalog);
            if (catalogJson.length() > 1950) {
                throw new IllegalArgumentException("自定义音色目录超出存储上限，请精简条目或使用自动内置音色目录");
            }
            upsertParam(VOICE_CATALOG_PARAM, catalogJson, "array",
                    "Podone 控制台可选内置音色目录");
        }

        String cleanBotoneUrl = StringUtils.removeEnd(StringUtils.trimToEmpty(botoneUrl), "/");
        upsertParam(BOTONE_URL_PARAM, cleanBotoneUrl, "string",
                "Botone 网页端地址，用于控制台联动深链");
    }

    public List<SysParamsDTO> getCoreInfraParams() {
        List<SysParamsDTO> all = params.list(Collections.emptyMap());
        if (all == null || all.isEmpty()) {
            return Collections.emptyList();
        }
        Map<String, SysParamsDTO> byCode = new LinkedHashMap<>();
        for (SysParamsDTO dto : all) {
            if (dto != null && dto.getParamCode() != null && CORE_INFRA_PARAM_CODES.contains(dto.getParamCode())) {
                byCode.put(dto.getParamCode(), dto);
            }
        }
        List<SysParamsDTO> ordered = new ArrayList<>();
        for (String code : CORE_INFRA_PARAM_CODES) {
            SysParamsDTO item = byCode.get(code);
            if (item != null) {
                ordered.add(item);
            }
        }
        return ordered;
    }

    private void upsertParam(String code, String value, String valueType, String remark) {
        int updated = params.updateValueByCode(code, value);
        if (updated > 0) {
            return;
        }
        SysParamsEntity entity = new SysParamsEntity();
        entity.setParamCode(code);
        entity.setParamValue(value);
        entity.setValueType(valueType);
        entity.setParamType(1);
        entity.setRemark(remark);
        params.insert(entity);
        params.updateValueByCode(code, value);
    }
}
