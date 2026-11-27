package xiaozhi.modules.pod.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class PodVoiceOption {
    @NotBlank
    @Size(max = 128)
    private String id;

    @NotBlank
    @Size(max = 64)
    private String name;

    @Size(max = 120)
    private String desc;

    private boolean enabled = true;
}
