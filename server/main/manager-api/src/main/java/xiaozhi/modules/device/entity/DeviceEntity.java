package xiaozhi.modules.device.entity;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import com.fasterxml.jackson.annotation.JsonIgnore;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = false)
@TableName("ai_device")
@Schema(description = "设备信息")
public class DeviceEntity {

    @TableId(type = IdType.ASSIGN_UUID)
    @Schema(description = "ID")
    private String id;

    @Schema(description = "关联用户ID")
    private Long userId;

    @Schema(description = "MAC地址")
    private String macAddress;

    @JsonIgnore
    private String pairedClientHash;

    @Schema(description = "最后连接时间")
    private Date lastConnectedAt;

    @Schema(description = "自动更新开关(0关闭/1开启)")
    private Integer autoUpdate;

    @Schema(description = "设备硬件型号")
    private String board;

    @Schema(description = "设备别名")
    private String alias;

    @Schema(description = "智能体ID")
    private String agentId;

    @Schema(description = "固件版本号")
    private String appVersion;

    @Schema(description = "设备专属TTS音色编码")
    private String ttsVoice;

    @Schema(description = "允许接收Bot主动来电(0关闭/1开启)")
    private Integer allowIncomingCall;

    @Schema(description = "允许播报异步结果与例行任务(0关闭/1开启)")
    private Integer allowAsyncNotice;

    @Schema(description = "是否启用夜间免打扰(0关闭/1开启)")
    private Integer dndEnabled;

    @Schema(description = "免打扰开始时间(HH:mm)")
    private String dndStart;

    @Schema(description = "免打扰结束时间(HH:mm)")
    private String dndEnd;

    @Schema(description = "排序")
    private Integer sort;

    @Schema(description = "更新者")
    @TableField(fill = FieldFill.UPDATE)
    private Long updater;

    @Schema(description = "更新时间")
    @TableField(fill = FieldFill.UPDATE)
    private Date updateDate;

    @Schema(description = "创建者")
    @TableField(fill = FieldFill.INSERT)
    private Long creator;

    @Schema(description = "创建时间")
    @TableField(fill = FieldFill.INSERT)
    private Date createDate;
}